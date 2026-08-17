import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { parseNonNegativeDecimal, parsePositiveDecimal } from '../../common/utils/decimal-input';
import { assertStoragePath } from '../../common/utils/storage-path';
import { hasRole, isCompanyWide } from '../../common/scope/ops-roles';
import { assertNotOnHold, assertProjectWritable } from '../../common/scope/project-lock';
import { requireCompany } from '../users/users-helpers';
import { ProjectAccessService } from './project-access.service';
import { fuelTotalCost, serializeFuel } from './serialize-fleet';
import { recalcSpend } from './spend';
import { maybeNotifyFuelAnomaly } from './fuel-anomaly';
import { CreateFuelDto, FuelListQueryDto, PatchFuelDto } from './fuel.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class FuelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: AuthUser, query: FuelListQueryDto) {
    this.assertFuelAccess(actor);
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.FuelEntryWhereInput = {
      companyId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.machineId ? { machineId: query.machineId } : {}),
      ...(await this.scopeWhere(actor)),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.fuelEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: query.order ?? 'desc' },
      }),
      this.prisma.fuelEntry.count({ where }),
    ]);
    return listResult(rows.map(serializeFuel), total, page, limit);
  }

  async getById(actor: AuthUser, id: string) {
    return serializeFuel(await this.loadVisible(actor, id));
  }

  async create(actor: AuthUser, dto: CreateFuelDto) {
    this.assertFuelWrite(actor);
    const companyId = requireCompany(actor);
    const machine = await this.requireMachine(companyId, dto.machineId);
    await this.assertCanFuelMachine(actor, machine.id);
    const projectId = await this.resolveProjectId(actor, machine.id, dto.projectId);
    if (dto.receiptPath) {
      assertStoragePath(dto.receiptPath, companyId);
    }
    const liters = parsePositiveDecimal(dto.liters, 'liters');
    const unitPrice = parseNonNegativeDecimal(dto.unitPrice, 'unitPrice');
    const row = await this.prisma.fuelEntry.create({
      data: {
        companyId,
        machineId: machine.id,
        userId: actor.id,
        projectId,
        liters,
        unitPrice,
        totalCost: fuelTotalCost(liters, unitPrice),
        notes: dto.notes,
        receiptPath: dto.receiptPath,
      },
    });
    if (projectId) {
      await recalcSpend(this.prisma, projectId);
    }
    await maybeNotifyFuelAnomaly({
      prisma: this.prisma,
      notifications: this.notifications,
      companyId,
      machineId: machine.id,
      liters,
      fuelId: row.id,
    });
    return serializeFuel(row);
  }

  async patch(actor: AuthUser, id: string, dto: PatchFuelDto) {
    const row = await this.loadVisible(actor, id);
    this.assertFuelWrite(actor);
    if (row.isSynced) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Synced fuel cannot be edited', 409);
    }
    const liters = dto.liters ? parsePositiveDecimal(dto.liters, 'liters') : row.liters;
    const unitPrice = dto.unitPrice
      ? parseNonNegativeDecimal(dto.unitPrice, 'unitPrice')
      : row.unitPrice;
    const updated = await this.prisma.fuelEntry.update({
      where: { id: row.id },
      data: {
        liters,
        unitPrice,
        totalCost: fuelTotalCost(liters, unitPrice),
        notes: dto.notes,
        projectId: dto.projectId,
        receiptPath: dto.receiptPath,
      },
    });
    return serializeFuel(updated);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    const row = await this.loadVisible(actor, id);
    this.assertFuelWrite(actor);
    if (row.isSynced) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Synced fuel cannot be deleted', 409);
    }
    await this.prisma.fuelEntry.delete({ where: { id: row.id } });
    if (row.projectId) {
      await recalcSpend(this.prisma, row.projectId);
    }
  }

  private async resolveProjectId(
    actor: AuthUser,
    machineId: string,
    projectId?: string,
  ): Promise<string | null> {
    const active = await this.prisma.machineAssignment.findFirst({
      where: { machineId, endedAt: null },
    });
    if (active && !projectId) {
      throw new AppError(ERROR_CODES.FUEL_PROJECT_REQUIRED, 'projectId required', 400);
    }
    if (!projectId) {
      return null;
    }
    if (active && active.projectId !== projectId) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'projectId must match assignment', 400);
    }
    const project = await this.access.getVisibleProject(actor, projectId);
    assertProjectWritable(project);
    assertNotOnHold(project);
    return project.id;
  }

  private async requireMachine(companyId: string, machineId: string) {
    const machine = await this.prisma.machine.findFirst({ where: { id: machineId, companyId } });
    if (!machine) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid machineId', 400);
    }
    if (machine.status === 'DECOMMISSIONED') {
      throw new AppError(ERROR_CODES.CONFLICT, 'Machine is decommissioned', 409);
    }
    return machine;
  }

  private async assertCanFuelMachine(actor: AuthUser, machineId: string): Promise<void> {
    if (isCompanyWide(actor) || hasRole(actor, 'SITE_SUPERVISOR')) {
      return;
    }
    const assigned = await this.prisma.machineAssignment.findFirst({
      where: { machineId, userId: actor.id, endedAt: null },
    });
    if (assigned) {
      return;
    }
    const driven = await this.prisma.trip.findFirst({
      where: { machineId, driverId: actor.id },
    });
    if (!driven) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Not allowed on this machine', 403);
    }
  }

  private async loadVisible(actor: AuthUser, id: string) {
    this.assertFuelAccess(actor);
    const row = await this.prisma.fuelEntry.findFirst({
      where: { id, companyId: requireCompany(actor), ...(await this.scopeWhere(actor)) },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Fuel entry not found', 404);
    }
    return row;
  }

  private async scopeWhere(actor: AuthUser): Promise<Prisma.FuelEntryWhereInput> {
    if (isCompanyWide(actor) || hasRole(actor, 'SITE_SUPERVISOR', 'PROJECT_MANAGER')) {
      return {};
    }
    return { userId: actor.id };
  }

  private assertFuelAccess(actor: AuthUser): void {
    if (!actor.permissions.includes('fuel.write') && !actor.permissions.includes('fuel.reports')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Fuel access not allowed', 403);
    }
  }

  private assertFuelWrite(actor: AuthUser): void {
    if (!actor.permissions.includes('fuel.write')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Fuel write not allowed', 403);
    }
  }
}

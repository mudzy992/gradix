import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { parsePositiveDecimal } from '../../common/utils/decimal-input';
import { assertStoragePath } from '../../common/utils/storage-path';
import { hasRole, isCompanyWide } from '../../common/scope/ops-roles';
import { assertNotOnHold, assertProjectWritable } from '../../common/scope/project-lock';
import { requireCompany } from '../users/users-helpers';
import { ProjectAccessService } from './project-access.service';
import { serializeTrip } from './serialize-fleet';
import { assertSyncedImmutable, assertTruckForTrip } from './trip-rules';
import { CompleteTripDto, CreateTripDto, PatchTripDto, TripListQueryDto } from './trips.dto';

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async list(actor: AuthUser, query: TripListQueryDto) {
    this.assertTripsRead(actor);
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.TripWhereInput = {
      companyId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(await this.scopeWhere(actor)),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: query.order ?? 'desc' },
      }),
      this.prisma.trip.count({ where }),
    ]);
    return listResult(rows.map(serializeTrip), total, page, limit);
  }

  async getById(actor: AuthUser, id: string) {
    return serializeTrip(await this.loadVisible(actor, id));
  }

  async create(actor: AuthUser, dto: CreateTripDto) {
    this.assertTripsWrite(actor);
    const project = await this.access.getVisibleProject(actor, dto.projectId);
    assertProjectWritable(project);
    assertNotOnHold(project);
    const machine = await this.prisma.machine.findFirst({
      where: { id: dto.machineId, companyId: project.companyId },
    });
    if (!machine) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid machineId', 400);
    }
    await assertTruckForTrip(this.prisma, machine, project.id, actor.id);
    const material = await this.prisma.material.findFirst({
      where: { id: dto.materialId, companyId: project.companyId, isActive: true },
    });
    if (!material) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid materialId', 400);
    }
    if (dto.weighTicketPath) {
      assertStoragePath(dto.weighTicketPath, project.companyId);
    }
    const dest = await this.resolveDest(project.companyId, dto.destDepotId, dto.destLat, dto.destLng);
    const row = await this.prisma.trip.create({
      data: {
        companyId: project.companyId,
        driverId: actor.id,
        projectId: project.id,
        machineId: machine.id,
        materialId: material.id,
        quantity: parsePositiveDecimal(dto.quantity, 'quantity'),
        originText: dto.originText,
        originLat: dto.originLat,
        originLng: dto.originLng,
        destDepotId: dest.destDepotId,
        destLat: dest.destLat,
        destLng: dest.destLng,
        weighTicketPath: dto.weighTicketPath,
        weighQty: dto.weighQty ? parsePositiveDecimal(dto.weighQty, 'weighQty') : undefined,
        notes: dto.notes,
      },
    });
    return serializeTrip(row);
  }

  async patch(actor: AuthUser, id: string, dto: PatchTripDto) {
    const trip = await this.loadVisible(actor, id);
    this.assertOwnerWrite(actor, trip.driverId);
    assertSyncedImmutable(trip.isSynced);
    const dest = dto.destDepotId !== undefined || dto.destLat !== undefined
      ? await this.resolveDest(trip.companyId, dto.destDepotId, dto.destLat, dto.destLng)
      : null;
    const row = await this.prisma.trip.update({
      where: { id: trip.id },
      data: {
        quantity: dto.quantity ? parsePositiveDecimal(dto.quantity, 'quantity') : undefined,
        notes: dto.notes,
        destDepotId: dest?.destDepotId,
        destLat: dest?.destLat,
        destLng: dest?.destLng,
        weighTicketPath: dto.weighTicketPath,
        weighQty: dto.weighQty ? parsePositiveDecimal(dto.weighQty, 'weighQty') : undefined,
      },
    });
    return serializeTrip(row);
  }

  async complete(actor: AuthUser, id: string, dto: CompleteTripDto) {
    const trip = await this.loadVisible(actor, id);
    this.assertOwnerWrite(actor, trip.driverId);
    if (trip.unloadedAt) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Trip already completed', 409);
    }
    let destLat = dto.destLat ?? trip.destLat?.toString() ?? null;
    let destLng = dto.destLng ?? trip.destLng?.toString() ?? null;
    if ((!destLat || !destLng) && trip.destDepotId) {
      const depot = await this.prisma.depot.findFirst({ where: { id: trip.destDepotId } });
      destLat = destLat ?? depot?.lat?.toString() ?? null;
      destLng = destLng ?? depot?.lng?.toString() ?? null;
    }
    const row = await this.prisma.trip.update({
      where: { id: trip.id },
      data: { unloadedAt: new Date(), destLat, destLng },
    });
    return serializeTrip(row);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    const trip = await this.loadVisible(actor, id);
    this.assertOwnerWrite(actor, trip.driverId);
    assertSyncedImmutable(trip.isSynced);
    await this.prisma.trip.delete({ where: { id: trip.id } });
  }

  private async loadVisible(actor: AuthUser, id: string) {
    this.assertTripsRead(actor);
    const trip = await this.prisma.trip.findFirst({
      where: { id, companyId: requireCompany(actor), ...(await this.scopeWhere(actor)) },
    });
    if (!trip) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Trip not found', 404);
    }
    return trip;
  }

  private async scopeWhere(actor: AuthUser): Promise<Prisma.TripWhereInput> {
    if (isCompanyWide(actor)) {
      return {};
    }
    if (hasRole(actor, 'DRIVER') && !hasRole(actor, 'PROJECT_MANAGER', 'SITE_SUPERVISOR')) {
      return { driverId: actor.id };
    }
    const projectIds = (
      await this.prisma.projectAssignment.findMany({
        where: { userId: actor.id },
        select: { projectId: true },
      })
    ).map((row) => row.projectId);
    return { projectId: { in: projectIds } };
  }

  private async resolveDest(
    companyId: string,
    destDepotId?: string,
    destLat?: string,
    destLng?: string,
  ) {
    if (!destDepotId) {
      return { destDepotId: null, destLat: destLat ?? null, destLng: destLng ?? null };
    }
    const depot = await this.prisma.depot.findFirst({
      where: { id: destDepotId, companyId, isActive: true },
    });
    if (!depot) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid destDepotId', 400);
    }
    return {
      destDepotId: depot.id,
      destLat: destLat ?? depot.lat?.toString() ?? null,
      destLng: destLng ?? depot.lng?.toString() ?? null,
    };
  }

  private assertOwnerWrite(actor: AuthUser, driverId: string): void {
    this.assertTripsWrite(actor);
    if (driverId !== actor.id && !isCompanyWide(actor)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Not trip owner', 403);
    }
  }

  private assertTripsRead(actor: AuthUser): void {
    if (!actor.permissions.includes('trips.read')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Trips read not allowed', 403);
    }
  }

  private assertTripsWrite(actor: AuthUser): void {
    if (!actor.permissions.includes('trips.write')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Trips write not allowed', 403);
    }
  }
}

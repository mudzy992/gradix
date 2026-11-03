import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import {
  canDecommission,
  hasRole,
  isCompanyWide,
} from '../../common/scope/ops-roles';
import { normalizeMachineCode } from '../../common/scope/ops-dates';
import { requireCompany } from '../users/users-helpers';
import { ProjectAccessService } from './project-access.service';
import { serializeMachine } from './serialize-machine';
import { parseMachineStatus } from './machine-status';
import {
  AssignMachineDto,
  CreateMachineDto,
  MachineListQueryDto,
  PatchMachineDto,
} from './machines.dto';

@Injectable()
export class MachinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, query: MachineListQueryDto) {
    this.assertFleetRead(actor);
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.MachineWhereInput = {
      companyId,
      ...(query.status ? { status: parseMachineStatus(query.status) } : {}),
      ...(query.projectId
        ? {
            assignments: {
              some: { projectId: query.projectId, endedAt: null },
            },
          }
        : {}),
      ...(await this.scopeWhere(actor)),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.machine.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: query.order ?? 'desc' },
      }),
      this.prisma.machine.count({ where }),
    ]);
    return listResult(rows.map(serializeMachine), total, page, limit);
  }

  async getById(actor: AuthUser, id: string) {
    return serializeMachine(await this.loadReadable(actor, id));
  }

  async create(actor: AuthUser, dto: CreateMachineDto) {
    this.assertFleetWrite(actor);
    const companyId = requireCompany(actor);
    const row = await this.prisma.machine.create({
      data: {
        companyId,
        name: dto.name,
        code: normalizeMachineCode(dto.code),
        type: dto.type,
      },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'MACHINE_CREATED',
      entityType: 'Machine',
      entityId: row.id,
      payload: { name: row.name, type: row.type },
    });
    return serializeMachine(row);
  }

  async patch(actor: AuthUser, id: string, dto: PatchMachineDto) {
    const machine = await this.loadWritable(actor, id);
    const row = await this.prisma.machine.update({
      where: { id: machine.id },
      data: {
        name: dto.name,
        code:
          dto.code !== undefined ? normalizeMachineCode(dto.code) : undefined,
      },
    });
    await this.audit.write({
      companyId: machine.companyId,
      actorId: actor.id,
      action: 'MACHINE_UPDATED',
      entityType: 'Machine',
      entityId: row.id,
      payload: { fields: Object.keys(dto) },
    });
    return serializeMachine(row);
  }

  async decommission(actor: AuthUser, id: string) {
    if (!canDecommission(actor)) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Only ADMIN can decommission',
        403,
      );
    }
    const machine = await this.loadWritable(actor, id);
    // BE-09 (F-02): mašina i njeni GPS uređaji se gase u jednoj transakciji.
    const row = await this.prisma.$transaction(async (tx) => {
      const row = await tx.machine.update({
        where: { id: machine.id },
        data: { status: 'DECOMMISSIONED' },
      });
      await tx.gpsDevice.updateMany({
        where: { machineId: machine.id },
        data: { isActive: false },
      });
      return row;
    });
    await this.audit.write({
      companyId: machine.companyId,
      actorId: actor.id,
      action: 'MACHINE_DECOMMISSIONED',
      entityType: 'Machine',
      entityId: row.id,
      payload: {},
    });
    return serializeMachine(row);
  }

  async assign(actor: AuthUser, id: string, dto: AssignMachineDto) {
    const machine = await this.loadWritable(actor, id);
    if (machine.status === 'DECOMMISSIONED') {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Machine is decommissioned',
        409,
      );
    }
    if (machine.status === 'IN_SERVICE') {
      throw new AppError(
        ERROR_CODES.MACHINE_IN_SERVICE,
        'Machine is in service',
        409,
      );
    }
    const project = await this.access.getVisibleProject(actor, dto.projectId);
    await this.access.assertScopedWrite(actor, project);
    // BE-09 (F-03): `MachineAssignment` nema unique ograničenje, pa je mašina mogla biti
    // na dva projekta istovremeno (P2002 grana ispod je bila mrtva). Invarijanta: jedna
    // otvorena dodjela po mašini — provjera ovdje + parcijalni unique indeks u migraciji.
    const open = await this.prisma.machineAssignment.findFirst({
      where: { machineId: machine.id, endedAt: null },
      select: { id: true, projectId: true },
    });
    if (open) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Machine already assigned', 409);
    }
    try {
      // BE-09 (F-02): dodjela i status mašine su jedna transakcija.
      const assignment = await this.prisma.$transaction(async (tx) => {
        const assignment = await tx.machineAssignment.create({
          data: {
            companyId: machine.companyId,
            machineId: machine.id,
            projectId: project.id,
            userId: dto.userId ?? null,
          },
        });
        await tx.machine.update({
          where: { id: machine.id },
          data: { status: 'ACTIVE' },
        });
        return assignment;
      });
      await this.audit.write({
        companyId: machine.companyId,
        actorId: actor.id,
        action: 'MACHINE_ASSIGNED',
        entityType: 'Machine',
        entityId: machine.id,
        payload: { projectId: project.id, userId: dto.userId ?? null },
      });
      return assignment;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'Machine already assigned',
          409,
        );
      }
      throw error;
    }
  }

  async unassign(actor: AuthUser, id: string) {
    const machine = await this.loadWritable(actor, id);
    const active = await this.prisma.machineAssignment.findFirst({
      where: { machineId: machine.id, endedAt: null },
    });
    if (!active) {
      throw new AppError(ERROR_CODES.CONFLICT, 'No active assignment', 409);
    }
    // BE-09 (F-02): zatvaranje dodjele i status mašine su jedna transakcija.
    // BE-09: ranije je status uvijek postajao IDLE — mašina „u servisu“ gubila je to stanje.
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.machineAssignment.update({
        where: { id: active.id },
        data: { endedAt: new Date() },
      });
      return await tx.machine.update({
        where: { id: machine.id },
        data: { status: machine.status === 'ACTIVE' ? 'IDLE' : machine.status },
      });
    });
    await this.audit.write({
      companyId: machine.companyId,
      actorId: actor.id,
      action: 'MACHINE_UNASSIGNED',
      entityType: 'Machine',
      entityId: machine.id,
      payload: { projectId: active.projectId },
    });
    return serializeMachine(row);
  }

  private async loadReadable(actor: AuthUser, id: string) {
    this.assertFleetRead(actor);
    const machine = await this.prisma.machine.findFirst({
      where: {
        id,
        companyId: requireCompany(actor),
        ...(await this.scopeWhere(actor)),
      },
    });
    if (!machine) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Machine not found', 404);
    }
    return machine;
  }

  private async loadWritable(actor: AuthUser, id: string) {
    this.assertFleetWrite(actor);
    const machine = await this.loadReadable(actor, id);
    if (isCompanyWide(actor) || hasRole(actor, 'PROJECT_MANAGER')) {
      return machine;
    }
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Fleet write not allowed', 403);
  }

  private async scopeWhere(actor: AuthUser): Promise<Prisma.MachineWhereInput> {
    if (isCompanyWide(actor) || hasRole(actor, 'MECHANIC')) {
      return {};
    }
    const projectIds = (
      await this.prisma.projectAssignment.findMany({
        where: { userId: actor.id },
        select: { projectId: true },
      })
    ).map((row) => row.projectId);
    const idle = hasRole(actor, 'PROJECT_MANAGER')
      ? [{ status: 'IDLE' as const }]
      : [];
    return {
      OR: [
        ...idle,
        {
          assignments: {
            some: { endedAt: null, projectId: { in: projectIds } },
          },
        },
      ],
    };
  }

  private assertFleetRead(actor: AuthUser): void {
    if (!actor.permissions.includes('fleet.read')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Fleet read not allowed', 403);
    }
  }

  private assertFleetWrite(actor: AuthUser): void {
    if (!actor.permissions.includes('fleet.write')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Fleet write not allowed', 403);
    }
  }
}

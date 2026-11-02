import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
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
    const row = await this.prisma.machine.update({
      where: { id: machine.id },
      data: { status: 'DECOMMISSIONED' },
    });
    await this.prisma.gpsDevice.updateMany({
      where: { machineId: machine.id },
      data: { isActive: false },
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
    const project = await this.access.getVisibleProject(actor, dto.projectId);
    await this.access.assertScopedWrite(actor, project);
    try {
      const assignment = await this.prisma.machineAssignment.create({
        data: {
          companyId: machine.companyId,
          machineId: machine.id,
          projectId: project.id,
          userId: dto.userId ?? null,
        },
      });
      await this.prisma.machine.update({
        where: { id: machine.id },
        data: { status: 'ACTIVE' },
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
    await this.prisma.machineAssignment.update({
      where: { id: active.id },
      data: { endedAt: new Date() },
    });
    const row = await this.prisma.machine.update({
      where: { id: machine.id },
      data: { status: 'IDLE' },
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

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  assertPlannedRange,
  parseOptionalDate,
} from '../../common/scope/ops-dates';
import { ProjectAccessService } from './project-access.service';
import { CreatePhaseDto, PatchPhaseDto } from './projects.dto';

@Injectable()
export class PhasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    await this.access.getVisibleProject(actor, projectId);
    return this.prisma.projectPhase.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(actor: AuthUser, projectId: string, dto: CreatePhaseDto) {
    const project = await this.access.getVisibleProject(actor, projectId);
    await this.access.assertScopedWrite(actor, project);
    const plannedStart = parseOptionalDate(dto.plannedStart);
    const plannedEnd = parseOptionalDate(dto.plannedEnd);
    assertPlannedRange(plannedStart ?? null, plannedEnd ?? null);
    const last = await this.prisma.projectPhase.findFirst({
      where: { projectId },
      orderBy: { sortOrder: 'desc' },
    });
    const phase = await this.prisma.projectPhase.create({
      data: {
        companyId: project.companyId,
        projectId,
        name: dto.name,
        sortOrder: dto.sortOrder ?? (last ? last.sortOrder + 1 : 0),
        plannedStart,
        plannedEnd,
      },
    });
    await this.audit.write({
      companyId: project.companyId,
      actorId: actor.id,
      action: 'PROJECT_PHASE_CREATED',
      entityType: 'ProjectPhase',
      entityId: phase.id,
      payload: { projectId, name: phase.name },
    });
    return phase;
  }

  async patch(
    actor: AuthUser,
    projectId: string,
    id: string,
    dto: PatchPhaseDto,
  ) {
    const project = await this.access.getVisibleProject(actor, projectId);
    await this.access.assertScopedWrite(actor, project);
    const phase = await this.requirePhase(projectId, id);
    const plannedStart =
      dto.plannedStart !== undefined
        ? (parseOptionalDate(dto.plannedStart) ?? null)
        : phase.plannedStart;
    const plannedEnd =
      dto.plannedEnd !== undefined
        ? (parseOptionalDate(dto.plannedEnd) ?? null)
        : phase.plannedEnd;
    assertPlannedRange(plannedStart, plannedEnd);
    const updated = await this.prisma.projectPhase.update({
      where: { id },
      data: {
        name: dto.name,
        sortOrder: dto.sortOrder,
        plannedStart: dto.plannedStart !== undefined ? plannedStart : undefined,
        plannedEnd: dto.plannedEnd !== undefined ? plannedEnd : undefined,
      },
    });
    await this.audit.write({
      companyId: project.companyId,
      actorId: actor.id,
      action: 'PROJECT_PHASE_UPDATED',
      entityType: 'ProjectPhase',
      entityId: id,
      payload: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async remove(actor: AuthUser, projectId: string, id: string): Promise<void> {
    const project = await this.access.getVisibleProject(actor, projectId);
    await this.access.assertScopedWrite(actor, project);
    await this.requirePhase(projectId, id);
    const inUse = await this.prisma.task.count({ where: { phaseId: id } });
    if (inUse > 0) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Phase has tasks', 409);
    }
    await this.prisma.projectPhase.delete({ where: { id } });
  }

  private async requirePhase(projectId: string, id: string) {
    const phase = await this.prisma.projectPhase.findFirst({
      where: { id, projectId },
    });
    if (!phase) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Phase not found', 404);
    }
    return phase;
  }
}

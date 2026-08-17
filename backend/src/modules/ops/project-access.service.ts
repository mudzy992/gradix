import { Injectable } from '@nestjs/common';
import { Project } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { requireCompany } from '../users/users-helpers';
import { canListProjects, hidesBudget, isCompanyWide } from '../../common/scope/ops-roles';
import { assertNotOnHold, assertProjectWritable } from '../../common/scope/project-lock';

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  requireCompany(actor: AuthUser): string {
    return requireCompany(actor);
  }

  assertCanList(actor: AuthUser): void {
    if (!canListProjects(actor)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Project list is not allowed', 403);
    }
  }

  serialize(project: Project, actor: AuthUser) {
    const base = {
      id: project.id,
      companyId: project.companyId,
      code: project.code,
      name: project.name,
      status: project.status,
      locality: project.locality,
      lat: project.lat?.toString() ?? null,
      lng: project.lng?.toString() ?? null,
      geofenceRadius: project.geofenceRadius,
      progressPercent: project.progressPercent,
      isPublic: project.isPublic,
      coverAssetId: project.coverAssetId,
      archivedAt: project.archivedAt,
      plannedStart: project.plannedStart,
      plannedEnd: project.plannedEnd,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    if (hidesBudget(actor)) {
      return base;
    }
    return {
      ...base,
      plannedBudget: project.plannedBudget?.toString() ?? null,
      currentSpend: project.currentSpend.toString(),
      client: project.client,
    };
  }

  async getVisibleProject(actor: AuthUser, id: string): Promise<Project> {
    const companyId = requireCompany(actor);
    const project = await this.prisma.project.findFirst({ where: { id, companyId } });
    if (!project) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Project not found', 404);
    }
    if (isCompanyWide(actor) || canListProjects(actor)) {
      if (!isCompanyWide(actor)) {
        const assigned = await this.prisma.projectAssignment.findFirst({
          where: { projectId: id, userId: actor.id },
        });
        if (!assigned) {
          throw new AppError(ERROR_CODES.NOT_FOUND, 'Project not found', 404);
        }
      }
      return project;
    }
    const assigned = await this.hasWorkerAccess(actor.id, id);
    if (!assigned) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Project not found', 404);
    }
    return project;
  }

  async hasWorkerAccess(userId: string, projectId: string): Promise<boolean> {
    const projectAssigned = await this.prisma.projectAssignment.findFirst({
      where: { projectId, userId },
    });
    if (projectAssigned) {
      return true;
    }
    const taskAssigned = await this.prisma.taskAssignment.findFirst({
      where: { userId, task: { projectId } },
    });
    return Boolean(taskAssigned);
  }

  async assertScopedWrite(actor: AuthUser, project: Project): Promise<void> {
    if (isCompanyWide(actor)) {
      return;
    }
    const assigned = await this.prisma.projectAssignment.findFirst({
      where: { projectId: project.id, userId: actor.id },
    });
    if (!assigned) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Project not found', 404);
    }
  }

  assertDispatchable(project: Project): void {
    assertProjectWritable(project);
    assertNotOnHold(project);
  }

  assertQtyWrite(project: Project, isAdminCorrection: boolean): void {
    if (project.status === 'ON_HOLD') {
      return;
    }
    if (
      (project.archivedAt ||
        project.status === 'COMPLETED' ||
        project.status === 'CANCELLED') &&
      !isAdminCorrection
    ) {
      throw new AppError(ERROR_CODES.PROJECT_TERMINAL, 'Project is terminal', 409);
    }
  }
}

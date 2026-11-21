import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { ProjectAccessService } from './project-access.service';
import { CreateAssignmentDto } from './projects.dto';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    await this.access.getVisibleProject(actor, projectId);
    return this.prisma.projectAssignment.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async create(actor: AuthUser, projectId: string, dto: CreateAssignmentDto) {
    const project = await this.access.getVisibleProject(actor, projectId);
    await this.access.assertScopedWrite(actor, project);
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, companyId: project.companyId },
    });
    if (!user || !user.isActive) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'User inactive or not in company',
        400,
      );
    }
    const row = await this.prisma.projectAssignment.create({
      data: {
        companyId: project.companyId,
        projectId,
        userId: dto.userId,
        role: dto.role,
      },
    });
    this.realtime.joinProject(dto.userId, projectId);
    await this.audit.write({
      companyId: project.companyId,
      actorId: actor.id,
      action: 'PROJECT_ASSIGNED',
      entityType: 'Project',
      entityId: projectId,
      payload: { userId: dto.userId, role: dto.role },
    });
    return row;
  }

  async remove(
    actor: AuthUser,
    projectId: string,
    userId: string,
  ): Promise<void> {
    const project = await this.access.getVisibleProject(actor, projectId);
    await this.access.assertScopedWrite(actor, project);
    const existing = await this.prisma.projectAssignment.findFirst({
      where: { projectId, userId },
    });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Assignment not found', 404);
    }
    await this.prisma.projectAssignment.delete({ where: { id: existing.id } });
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    const wide = target?.roles.some((item) =>
      ['ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT', 'PLATFORM_ADMIN'].includes(
        item.role,
      ),
    );
    if (!wide) {
      this.realtime.leaveProject(userId, projectId);
    }
    await this.audit.write({
      companyId: project.companyId,
      actorId: actor.id,
      action: 'PROJECT_UNASSIGNED',
      entityType: 'Project',
      entityId: projectId,
      payload: { userId },
    });
  }
}

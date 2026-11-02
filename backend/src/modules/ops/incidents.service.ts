import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { HSE_PHOTO_MAX } from '../../common/constants';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { assertStoragePath } from '../../common/utils/storage-path';
import { parseDecimal } from '../../common/utils/decimal-input';
import { hasRole, isCompanyWide } from '../../common/scope/ops-roles';
import { requireCompany } from '../users/users-helpers';
import { ProjectAccessService } from './project-access.service';
import {
  CreateIncidentDto,
  IncidentListQueryDto,
  PatchIncidentDto,
} from './incidents.dto';
import { serializeIncident } from './serialize-diary';

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: AuthUser, query: IncidentListQueryDto) {
    this.assertRead(actor);
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.IncidentWhereInput = {
      companyId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status
        ? { status: query.status as Prisma.EnumIncidentStatusFilter['equals'] }
        : {}),
      ...this.scopeWhere(actor),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.incident.findMany({
        where,
        include: { photos: true },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.incident.count({ where }),
    ]);
    return listResult(rows.map(serializeIncident), total, page, limit);
  }

  async create(actor: AuthUser, dto: CreateIncidentDto) {
    if (!actor.permissions.includes('hse.write')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'HSE write not allowed', 403);
    }
    const companyId = requireCompany(actor);
    if (dto.projectId) {
      await this.access.getVisibleProject(actor, dto.projectId);
    }
    const paths = dto.paths ?? [];
    if (paths.length > HSE_PHOTO_MAX) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Max 5 incident photos',
        400,
      );
    }
    const row = await this.prisma.incident.create({
      data: {
        companyId,
        projectId: dto.projectId,
        taskId: dto.taskId,
        userId: actor.id,
        severity: dto.severity,
        description: dto.description,
        lat: dto.lat ? parseDecimal(dto.lat, 'lat') : undefined,
        lng: dto.lng ? parseDecimal(dto.lng, 'lng') : undefined,
        photos: {
          create: paths.map((path) => ({
            companyId,
            path: assertStoragePath(path, companyId),
          })),
        },
      },
      include: { photos: true },
    });
    await this.notifyCreated(companyId, row.id, dto.projectId);
    return serializeIncident(row);
  }

  async patch(actor: AuthUser, id: string, dto: PatchIncidentDto) {
    this.assertRead(actor);
    const companyId = requireCompany(actor);
    const row = await this.prisma.incident.findFirst({
      where: { id, companyId, ...this.scopeWhere(actor) },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Incident not found', 404);
    }
    const updated = await this.prisma.incident.update({
      where: { id },
      data: { status: dto.status },
      include: { photos: true },
    });
    return serializeIncident(updated);
  }

  private assertRead(actor: AuthUser): true {
    if (!actor.permissions.includes('hse.read')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'HSE read not allowed', 403);
    }
    return true;
  }

  private scopeWhere(actor: AuthUser): Prisma.IncidentWhereInput {
    if (isCompanyWide(actor)) {
      return {};
    }
    if (hasRole(actor, 'PROJECT_MANAGER', 'SITE_SUPERVISOR')) {
      return {
        OR: [
          { projectId: null },
          { project: { assignments: { some: { userId: actor.id } } } },
        ],
      };
    }
    return { userId: actor.id };
  }

  private async notifyCreated(
    companyId: string,
    incidentId: string,
    projectId?: string,
  ) {
    const recipients = await this.prisma.userRoleAssignment.findMany({
      where: {
        user: { companyId, isActive: true },
        role: {
          in: ['ADMIN', 'SUPER_ADMIN', 'SITE_SUPERVISOR', 'PROJECT_MANAGER'],
        },
      },
      select: { userId: true },
    });
    const unique = [...new Set(recipients.map((row) => row.userId))];
    for (const userId of unique) {
      await this.notifications.createForUser({
        companyId,
        userId,
        type: 'HSE_CREATED',
        title: 'HSE incident',
        message: 'A new incident was reported',
        data: { incidentId, projectId },
      });
    }
  }
}

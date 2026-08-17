import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { canPickProjects, hasRole } from '../../common/scope/ops-roles';
import {
  assertGeofenceRadius,
  assertPlannedRange,
  normalizeProjectCode,
  parseOptionalDate,
} from '../../common/scope/ops-dates';
import { assertStatusTransition } from '../../common/scope/project-lock';
import { projectListWhere } from '../../common/scope/scope-by-project';
import { ProjectAccessService } from './project-access.service';
import {
  CreateProjectDto,
  PatchProjectDto,
  PatchProjectStatusDto,
  ProjectListQueryDto,
} from './projects.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly access: ProjectAccessService,
  ) {}

  async list(actor: AuthUser, query: ProjectListQueryDto) {
    this.access.assertCanList(actor);
    const companyId = this.access.requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const archived = query.archived === 'true';
    if (archived && !hasRole(actor, 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'PROJECT_MANAGER')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'archived filter not allowed', 403);
    }
    const where = projectListWhere(actor, { status: query.status, q: query.q, archived });
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: query.order ?? 'desc' },
      }),
      this.prisma.project.count({ where }),
    ]);
    void companyId;
    return listResult(rows.map((row) => this.access.serialize(row, actor)), total, page, limit);
  }

  async listPicker(actor: AuthUser) {
    if (!canPickProjects(actor)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Project picker not allowed', 403);
    }
    const companyId = this.access.requireCompany(actor);
    const assigned = await this.prisma.projectAssignment.findMany({
      where: { userId: actor.id, companyId },
      select: { projectId: true },
    });
    const machineProjects = await this.prisma.machineAssignment.findMany({
      where: { userId: actor.id, endedAt: null, companyId },
      select: { projectId: true },
    });
    const ids = [
      ...new Set([
        ...assigned.map((row) => row.projectId),
        ...machineProjects.map((row) => row.projectId),
      ]),
    ];
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.prisma.project.findMany({
      where: { companyId, id: { in: ids }, archivedAt: null },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      locality: row.locality,
      status: row.status,
    }));
  }

  async getById(actor: AuthUser, id: string) {
    return this.access.serialize(await this.access.getVisibleProject(actor, id), actor);
  }

  async create(actor: AuthUser, dto: CreateProjectDto) {
    const companyId = this.access.requireCompany(actor);
    const plannedStart = parseOptionalDate(dto.plannedStart);
    const plannedEnd = parseOptionalDate(dto.plannedEnd);
    assertPlannedRange(plannedStart ?? null, plannedEnd ?? null);
    const radius = dto.geofenceRadius ?? (await this.defaultRadius(companyId));
    assertGeofenceRadius(radius);
    const project = await this.prisma.project.create({
      data: {
        companyId,
        code: normalizeProjectCode(dto.code),
        name: dto.name,
        locality: dto.locality,
        lat: dto.lat,
        lng: dto.lng,
        geofenceRadius: radius,
        plannedBudget: dto.plannedBudget,
        client: dto.client,
        plannedStart,
        plannedEnd,
      },
    });
    if (hasRole(actor, 'PROJECT_MANAGER')) {
      await this.prisma.projectAssignment.create({
        data: { companyId, projectId: project.id, userId: actor.id, role: 'PM' },
      });
      this.realtime.joinProject(actor.id, project.id);
    }
    this.realtime.joinCompanyWideToProject(companyId, project.id);
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'PROJECT_CREATED',
      entityType: 'Project',
      entityId: project.id,
      payload: { name: project.name },
    });
    return this.access.serialize(project, actor);
  }

  async patch(actor: AuthUser, id: string, dto: PatchProjectDto) {
    const project = await this.access.getVisibleProject(actor, id);
    await this.access.assertScopedWrite(actor, project);
    const plannedStart = dto.plannedStart !== undefined
      ? parseOptionalDate(dto.plannedStart) ?? null
      : project.plannedStart;
    const plannedEnd = dto.plannedEnd !== undefined
      ? parseOptionalDate(dto.plannedEnd) ?? null
      : project.plannedEnd;
    assertPlannedRange(plannedStart, plannedEnd);
    if (dto.geofenceRadius !== undefined) {
      assertGeofenceRadius(dto.geofenceRadius);
    }
    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        code: dto.code !== undefined ? normalizeProjectCode(dto.code) : undefined,
        name: dto.name,
        locality: dto.locality,
        lat: dto.lat,
        lng: dto.lng,
        geofenceRadius: dto.geofenceRadius,
        plannedBudget: dto.plannedBudget,
        client: dto.client,
        plannedStart: dto.plannedStart !== undefined ? plannedStart : undefined,
        plannedEnd: dto.plannedEnd !== undefined ? plannedEnd : undefined,
      },
    });
    return this.access.serialize(updated, actor);
  }

  async patchStatus(actor: AuthUser, id: string, dto: PatchProjectStatusDto) {
    const project = await this.access.getVisibleProject(actor, id);
    await this.access.assertScopedWrite(actor, project);
    assertStatusTransition(project.status, dto.status);
    const updated = await this.prisma.project.update({
      where: { id },
      data: { status: dto.status },
    });
    await this.audit.write({
      companyId: project.companyId,
      actorId: actor.id,
      action: 'PROJECT_STATUS',
      entityType: 'Project',
      entityId: id,
      payload: { from: project.status, to: dto.status },
    });
    return this.access.serialize(updated, actor);
  }

  async archive(actor: AuthUser, id: string): Promise<void> {
    const project = await this.access.getVisibleProject(actor, id);
    await this.access.assertScopedWrite(actor, project);
    await this.prisma.project.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  private async defaultRadius(companyId: string): Promise<number> {
    const row = await this.prisma.setting.findUnique({
      where: { companyId_key: { companyId, key: 'geofence.defaultRadiusM' } },
    });
    const value = row?.value;
    return typeof value === 'number' ? value : 200;
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { parseNonNegativeDecimal } from '../../common/utils/decimal-input';
import { assertStoragePath } from '../../common/utils/storage-path';
import { hasRole } from '../../common/scope/ops-roles';
import { requireCompany } from '../users/users-helpers';
import {
  CreateTenderDto,
  PatchTenderDto,
  TenderAttachmentDto,
  TenderListQueryDto,
} from './tenders.dto';
import { assertTenderTransition } from './tender-status';
import { serializeTender } from './serialize-tender';

@Injectable()
export class TendersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(actor: AuthUser, query: TenderListQueryDto) {
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.TenderWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { title: { contains: query.q } } : {}),
    };
    const avg = await this.avgCompletedSpend(companyId);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tender.findMany({
        where,
        include: { attachments: true },
        skip,
        take: limit,
        orderBy: { createdAt: query.order ?? 'desc' },
      }),
      this.prisma.tender.count({ where }),
    ]);
    return listResult(
      rows.map((row) => serializeTender(row, avg)),
      total,
      page,
      limit,
    );
  }

  async getById(actor: AuthUser, id: string) {
    const companyId = requireCompany(actor);
    const row = await this.load(companyId, id);
    return serializeTender(row, await this.avgCompletedSpend(companyId));
  }

  async create(actor: AuthUser, dto: CreateTenderDto) {
    const companyId = requireCompany(actor);
    const row = await this.prisma.tender.create({
      data: {
        companyId,
        title: dto.title,
        client: dto.client,
        submittedValue: dto.submittedValue
          ? parseNonNegativeDecimal(dto.submittedValue, 'submittedValue')
          : undefined,
        submittedAt: dto.submittedAt ? new Date(dto.submittedAt) : undefined,
        notes: dto.notes,
      },
      include: { attachments: true },
    });
    return serializeTender(row, await this.avgCompletedSpend(companyId));
  }

  async patch(actor: AuthUser, id: string, dto: PatchTenderDto) {
    const companyId = requireCompany(actor);
    const row = await this.load(companyId, id);
    if (dto.status) {
      assertTenderTransition(row.status, dto.status);
    }
    const updated = await this.prisma.tender.update({
      where: { id },
      data: {
        title: dto.title,
        client: dto.client,
        notes: dto.notes,
        submittedValue: dto.submittedValue
          ? parseNonNegativeDecimal(dto.submittedValue, 'submittedValue')
          : undefined,
        status: dto.status,
        submittedAt:
          dto.status === 'SUBMITTED' && !row.submittedAt
            ? new Date()
            : undefined,
      },
      include: { attachments: true },
    });
    return serializeTender(updated, await this.avgCompletedSpend(companyId));
  }

  async addAttachment(actor: AuthUser, id: string, dto: TenderAttachmentDto) {
    const companyId = requireCompany(actor);
    await this.load(companyId, id);
    assertStoragePath(dto.path, companyId);
    await this.prisma.tenderAttachment.create({
      data: { companyId, tenderId: id, path: dto.path, fileName: dto.fileName },
    });
    return this.getById(actor, id);
  }

  async convert(actor: AuthUser, id: string) {
    const companyId = requireCompany(actor);
    const tender = await this.load(companyId, id);
    if (tender.status !== 'WON' || tender.convertedProjectId) {
      throw new AppError(
        ERROR_CODES.TENDER_INVALID_STATUS,
        'Convert requires WON',
        409,
      );
    }
    const radius = await this.defaultRadius(companyId);
    const project = await this.prisma.project.create({
      data: {
        companyId,
        name: tender.title,
        client: tender.client,
        plannedBudget: tender.submittedValue,
        status: 'PLANNING',
        isPublic: false,
        geofenceRadius: radius,
      },
    });
    if (hasRole(actor, 'PROJECT_MANAGER')) {
      await this.prisma.projectAssignment.create({
        data: {
          companyId,
          projectId: project.id,
          userId: actor.id,
          role: 'PM',
        },
      });
      this.realtime.joinProject(actor.id, project.id);
    }
    this.realtime.joinCompanyWideToProject(companyId, project.id);
    await this.prisma.tender.update({
      where: { id },
      data: { convertedProjectId: project.id },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'PROJECT_CREATED',
      entityType: 'Project',
      entityId: project.id,
      payload: { fromTenderId: id },
    });
    return this.getById(actor, id);
  }

  async avgCompletedSpend(companyId: string): Promise<string | null> {
    const agg = await this.prisma.project.aggregate({
      where: { companyId, status: 'COMPLETED', archivedAt: null },
      _avg: { currentSpend: true },
      _count: { _all: true },
    });
    if (!agg._count._all) {
      return null;
    }
    return agg._avg.currentSpend?.toString() ?? '0';
  }

  private async load(companyId: string, id: string) {
    const row = await this.prisma.tender.findFirst({
      where: { id, companyId },
      include: { attachments: true },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Tender not found', 404);
    }
    return row;
  }

  private async defaultRadius(companyId: string): Promise<number> {
    const row = await this.prisma.setting.findUnique({
      where: { companyId_key: { companyId, key: 'geofence.defaultRadiusM' } },
    });
    return typeof row?.value === 'number' ? row.value : 200;
  }
}

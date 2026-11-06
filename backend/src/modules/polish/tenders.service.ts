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
import { parseIsoDateTime } from '../../common/utils/date-input';
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
      // BE-15 (F-10): pretraga je bila case-sensitive (`Bridge` nije nalazio `bridge`).
      ...(query.q
        ? { title: { contains: query.q, mode: 'insensitive' as const } }
        : {}),
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
          ? parseNonNegativeDecimal(dto.submittedValue, 'submittedValue', 2)
          : undefined,
        // BE-15 (F-06): `new Date('nije-datum')` je ranije pravio `Invalid Date`
        // koji Prisma pretvori u 500; sada je 400.
        submittedAt: dto.submittedAt
          ? parseIsoDateTime(dto.submittedAt, 'submittedAt')
          : undefined,
        notes: dto.notes,
      },
      include: { attachments: true },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'TENDER_CREATED',
      entityType: 'Tender',
      entityId: row.id,
      payload: { title: row.title, client: row.client, status: row.status },
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
          ? parseNonNegativeDecimal(dto.submittedValue, 'submittedValue', 2)
          : undefined,
        status: dto.status,
        submittedAt:
          dto.status === 'SUBMITTED' && !row.submittedAt
            ? new Date()
            : undefined,
      },
      include: { attachments: true },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'TENDER_UPDATED',
      entityType: 'Tender',
      entityId: updated.id,
      payload: {
        fromStatus: row.status,
        toStatus: updated.status,
        ...(dto.title ? { title: updated.title } : {}),
      },
    });
    return serializeTender(updated, await this.avgCompletedSpend(companyId));
  }

  async addAttachment(actor: AuthUser, id: string, dto: TenderAttachmentDto) {
    const companyId = requireCompany(actor);
    await this.load(companyId, id);
    assertStoragePath(dto.path, companyId);
    const attachment = await this.prisma.tenderAttachment.create({
      data: { companyId, tenderId: id, path: dto.path, fileName: dto.fileName },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'TENDER_ATTACHMENT_ADDED',
      entityType: 'TenderAttachment',
      entityId: attachment.id,
      payload: { tenderId: id, fileName: attachment.fileName },
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
    // BE-15 (F-02): konverzija je bila „provjeri pa upiši“ kroz tri odvojena upisa —
    // dva paralelna klika su pravila **dva** projekta iz jednog tendera, a pad na
    // pola je ostavljao projekat bez veze na tender. Sada je sve u transakciji, a
    // tender se „zaključava“ atomski (`convertedProjectId` je i unique u šemi).
    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
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
        await tx.projectAssignment.create({
          data: {
            companyId,
            projectId: created.id,
            userId: actor.id,
            role: 'PM',
          },
        });
      }
      const claimed = await tx.tender.updateMany({
        where: { id, companyId, status: 'WON', convertedProjectId: null },
        data: { convertedProjectId: created.id },
      });
      if (claimed.count === 0) {
        throw new AppError(
          ERROR_CODES.TENDER_INVALID_STATUS,
          'Tender is already converted',
          409,
        );
      }
      return created;
    });
    if (hasRole(actor, 'PROJECT_MANAGER')) {
      this.realtime.joinProject(actor.id, project.id);
    }
    this.realtime.joinCompanyWideToProject(companyId, project.id);
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'PROJECT_CREATED',
      entityType: 'Project',
      entityId: project.id,
      payload: { fromTenderId: id },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'TENDER_CONVERTED',
      entityType: 'Tender',
      entityId: id,
      payload: { projectId: project.id },
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

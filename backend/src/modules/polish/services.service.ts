import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimerForceCloseService } from '../ops/timer-force-close.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { parseNonNegativeDecimal } from '../../common/utils/decimal-input';
import { requireCompany } from '../users/users-helpers';
import { recalcSpend } from '../ops/spend';
import {
  CompleteServiceDto,
  CreateServiceDto,
  CreateTemplateDto,
  PatchTemplateDto,
  ServiceListQueryDto,
  TemplateListQueryDto,
} from './services.dto';
import { serializeService, serializeTemplate } from './serialize-service';
import { restoreMachine, startServiceRecord } from './service-start';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly closer: TimerForceCloseService,
    private readonly audit: AuditService,
  ) {}

  async listTemplates(actor: AuthUser, query: TemplateListQueryDto) {
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.serviceTemplate.findMany({
        where: { companyId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.serviceTemplate.count({ where: { companyId } }),
    ]);
    return listResult(rows.map(serializeTemplate), total, page, limit);
  }

  async createTemplate(actor: AuthUser, dto: CreateTemplateDto) {
    const companyId = requireCompany(actor);
    const row = await this.prisma.serviceTemplate.create({
      data: { companyId, ...dto },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'SERVICE_TEMPLATE_CREATED',
      entityType: 'ServiceTemplate',
      entityId: row.id,
      payload: {
        machineType: row.machineType,
        intervalHours: row.intervalHours,
      },
    });
    return serializeTemplate(row);
  }

  async patchTemplate(actor: AuthUser, id: string, dto: PatchTemplateDto) {
    const companyId = requireCompany(actor);
    await this.loadTemplate(companyId, id);
    const row = await this.prisma.serviceTemplate.update({
      where: { id },
      data: dto,
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'SERVICE_TEMPLATE_UPDATED',
      entityType: 'ServiceTemplate',
      entityId: row.id,
      payload: { intervalHours: row.intervalHours, title: row.title },
    });
    return serializeTemplate(row);
  }

  async list(actor: AuthUser, query: ServiceListQueryDto) {
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.ServiceRecordWhereInput = {
      companyId,
      ...(query.machineId ? { machineId: query.machineId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.serviceRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: query.order ?? 'desc' },
      }),
      this.prisma.serviceRecord.count({ where }),
    ]);
    return listResult(rows.map(serializeService), total, page, limit);
  }

  async create(actor: AuthUser, dto: CreateServiceDto) {
    const companyId = requireCompany(actor);
    const machine = await this.prisma.machine.findFirst({
      where: { id: dto.machineId, companyId },
    });
    if (!machine) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Machine not found', 404);
    }
    // BE-15 (F-03): `projectId`/`templateId` su se upisivali bez provjere firme —
    // servis je mogao biti „zakačen“ na tuđi projekat (cross-tenant referenca).
    if (dto.projectId) {
      await this.assertProject(companyId, dto.projectId);
    }
    if (dto.templateId) {
      await this.loadTemplate(companyId, dto.templateId);
    }
    const row = await this.prisma.serviceRecord.create({
      data: {
        companyId,
        machineId: machine.id,
        projectId: dto.projectId,
        templateId: dto.templateId,
        note: dto.note,
      },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'SERVICE_CREATED',
      entityType: 'ServiceRecord',
      entityId: row.id,
      payload: { machineId: row.machineId, templateId: row.templateId },
    });
    return serializeService(row);
  }

  async start(actor: AuthUser, id: string) {
    const companyId = requireCompany(actor);
    const { record, machine } = await this.loadWithMachine(companyId, id);
    const row = await startServiceRecord({
      prisma: this.prisma,
      closer: this.closer,
      record,
      machine,
      actorId: actor.id,
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'SERVICE_STARTED',
      entityType: 'ServiceRecord',
      entityId: row.id,
      payload: {
        machineId: machine.id,
        previousMachineStatus: row.previousMachineStatus,
      },
    });
    return row;
  }

  async complete(actor: AuthUser, id: string, dto: CompleteServiceDto) {
    const { record, machine } = await this.loadWithMachine(
      requireCompany(actor),
      id,
    );
    if (record.status !== 'IN_PROGRESS') {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Service is not in progress',
        400,
      );
    }
    const totalCost = dto.totalCost
      ? parseNonNegativeDecimal(dto.totalCost, 'totalCost')
      : record.totalCost;
    // BE-15 (F-01): završetak je bio „provjeri pa upiši“ kroz tri upisa; dupli klik
    // je dva puta vraćao status mašine, a pad između upisa ostavljao mašinu u servisu.
    // Sada je jedan atomski claim + restore mašine + `recalcSpend` u istoj transakciji.
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.serviceRecord.updateMany({
        where: { id, companyId: record.companyId, status: 'IN_PROGRESS' },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          totalCost,
          note: dto.note ?? record.note,
        },
      });
      if (claimed.count === 0) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'Service is not in progress',
          409,
        );
      }
      await restoreMachine(tx, machine.id);
      if (record.projectId) {
        await recalcSpend(tx, record.projectId);
      }
      return tx.serviceRecord.findUniqueOrThrow({ where: { id } });
    });
    await this.audit.write({
      companyId: record.companyId,
      actorId: actor.id,
      action: 'SERVICE_COMPLETED',
      entityType: 'ServiceRecord',
      entityId: updated.id,
      payload: { totalCost: updated.totalCost?.toString() ?? null },
    });
    return serializeService(updated);
  }

  async cancel(actor: AuthUser, id: string) {
    const { record, machine } = await this.loadWithMachine(
      requireCompany(actor),
      id,
    );
    if (record.status === 'COMPLETED' || record.status === 'CANCELLED') {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Service is terminal',
        400,
      );
    }
    const wasOpen = record.status === 'IN_PROGRESS';
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.serviceRecord.updateMany({
        where: {
          id,
          companyId: record.companyId,
          status: { in: ['PLANNED', 'SCHEDULED', 'IN_PROGRESS'] },
        },
        data: { status: 'CANCELLED' },
      });
      if (claimed.count === 0) {
        throw new AppError(ERROR_CODES.CONFLICT, 'Service is terminal', 409);
      }
      if (wasOpen) {
        await restoreMachine(tx, machine.id);
      }
      return tx.serviceRecord.findUniqueOrThrow({ where: { id } });
    });
    await this.audit.write({
      companyId: record.companyId,
      actorId: actor.id,
      action: 'SERVICE_CANCELLED',
      entityType: 'ServiceRecord',
      entityId: updated.id,
      payload: { wasInProgress: wasOpen },
    });
    return serializeService(updated);
  }

  private async assertProject(
    companyId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
    });
    if (!project) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Invalid projectId',
        400,
      );
    }
  }

  private async loadTemplate(companyId: string, id: string) {
    const row = await this.prisma.serviceTemplate.findFirst({
      where: { id, companyId },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Template not found', 404);
    }
    return row;
  }

  private async loadWithMachine(companyId: string, id: string) {
    const record = await this.prisma.serviceRecord.findFirst({
      where: { id, companyId },
    });
    if (!record) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Service not found', 404);
    }
    const machine = await this.prisma.machine.findFirstOrThrow({
      where: { id: record.machineId },
    });
    return { record, machine };
  }
}

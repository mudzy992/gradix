import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
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
import { startServiceRecord } from './service-start';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly closer: TimerForceCloseService,
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
    return serializeTemplate(
      await this.prisma.serviceTemplate.create({ data: { companyId, ...dto } }),
    );
  }

  async patchTemplate(actor: AuthUser, id: string, dto: PatchTemplateDto) {
    await this.loadTemplate(requireCompany(actor), id);
    return serializeTemplate(
      await this.prisma.serviceTemplate.update({ where: { id }, data: dto }),
    );
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
    const row = await this.prisma.serviceRecord.create({
      data: {
        companyId,
        machineId: machine.id,
        projectId: dto.projectId,
        templateId: dto.templateId,
        note: dto.note,
      },
    });
    return serializeService(row);
  }

  async start(actor: AuthUser, id: string) {
    const { record, machine } = await this.loadWithMachine(requireCompany(actor), id);
    return startServiceRecord({
      prisma: this.prisma,
      closer: this.closer,
      record,
      machine,
      actorId: actor.id,
    });
  }

  async complete(actor: AuthUser, id: string, dto: CompleteServiceDto) {
    const { record, machine } = await this.loadWithMachine(requireCompany(actor), id);
    if (record.status !== 'IN_PROGRESS') {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Service is not in progress', 400);
    }
    const totalCost = dto.totalCost
      ? parseNonNegativeDecimal(dto.totalCost, 'totalCost')
      : record.totalCost;
    const updated = await this.prisma.serviceRecord.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        totalCost,
        note: dto.note ?? record.note,
      },
    });
    await this.restoreMachine(machine.id);
    if (updated.projectId) {
      await recalcSpend(this.prisma, updated.projectId);
    }
    return serializeService(updated);
  }

  async cancel(actor: AuthUser, id: string) {
    const { record, machine } = await this.loadWithMachine(requireCompany(actor), id);
    if (record.status === 'COMPLETED' || record.status === 'CANCELLED') {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Service is terminal', 400);
    }
    const wasOpen = record.status === 'IN_PROGRESS';
    const updated = await this.prisma.serviceRecord.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    if (wasOpen) {
      await this.restoreMachine(machine.id);
    }
    return serializeService(updated);
  }

  private async restoreMachine(machineId: string): Promise<void> {
    const active = await this.prisma.machineAssignment.findFirst({
      where: { machineId, endedAt: null },
    });
    await this.prisma.machine.update({
      where: { id: machineId },
      data: { status: active ? 'ACTIVE' : 'IDLE' },
    });
  }

  private async loadTemplate(companyId: string, id: string) {
    const row = await this.prisma.serviceTemplate.findFirst({ where: { id, companyId } });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Template not found', 404);
    }
    return row;
  }

  private async loadWithMachine(companyId: string, id: string) {
    const record = await this.prisma.serviceRecord.findFirst({ where: { id, companyId } });
    if (!record) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Service not found', 404);
    }
    const machine = await this.prisma.machine.findFirstOrThrow({
      where: { id: record.machineId },
    });
    return { record, machine };
  }
}

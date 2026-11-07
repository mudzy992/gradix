import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { assertStoragePath } from '../../common/utils/storage-path';
import { requireCompany } from '../users/users-helpers';
import {
  CreateCompanyDocDto,
  CreateMachineDocDto,
  CreateWorkerDocDto,
  DocsListQueryDto,
  PatchDocDto,
} from './docs.dto';
import { parseExpires, serializeDoc } from './serialize-doc';

@Injectable()
export class DocsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listCompany(actor: AuthUser, query: DocsListQueryDto) {
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.companyDocument.findMany({
        where: { companyId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.companyDocument.count({ where: { companyId } }),
    ]);
    return listResult(rows.map(serializeDoc), total, page, limit);
  }

  async createCompany(actor: AuthUser, dto: CreateCompanyDocDto) {
    const companyId = requireCompany(actor);
    assertStoragePath(dto.filePath, companyId);
    const row = await this.prisma.companyDocument.create({
      data: {
        companyId,
        type: dto.type,
        filePath: dto.filePath,
        expiresAt: parseExpires(dto.expiresAt),
        note: dto.note,
      },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'DOCUMENT_CREATED',
      entityType: 'CompanyDocument',
      entityId: row.id,
      payload: {
        type: row.type,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      },
    });
    return serializeDoc(row);
  }

  async patchCompany(actor: AuthUser, id: string, dto: PatchDocDto) {
    const companyId = requireCompany(actor);
    const existing = await this.prisma.companyDocument.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Document not found', 404);
    }
    if (dto.filePath) {
      assertStoragePath(dto.filePath, companyId);
    }
    const row = await this.prisma.companyDocument.update({
      where: { id },
      data: {
        type: dto.type,
        filePath: dto.filePath,
        expiresAt:
          dto.expiresAt !== undefined
            ? (parseExpires(dto.expiresAt) ?? null)
            : undefined,
        note: dto.note,
      },
    });
    // BE-15 (F-03): dokumenti su compliance zapisi — izmjena roka mora ostati u auditu.
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'DOCUMENT_UPDATED',
      entityType: 'CompanyDocument',
      entityId: row.id,
      payload: {
        type: row.type,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      },
    });
    return serializeDoc(row);
  }

  async listWorker(actor: AuthUser, query: DocsListQueryDto) {
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.workerDocument.findMany({
        where: { companyId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.workerDocument.count({ where: { companyId } }),
    ]);
    return listResult(rows.map(serializeDoc), total, page, limit);
  }

  async createWorker(actor: AuthUser, dto: CreateWorkerDocDto) {
    const companyId = requireCompany(actor);
    assertStoragePath(dto.filePath, companyId);
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, companyId },
    });
    if (!user) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid userId', 400);
    }
    const row = await this.prisma.workerDocument.create({
      data: {
        companyId,
        userId: dto.userId,
        type: dto.type,
        filePath: dto.filePath,
        expiresAt: parseExpires(dto.expiresAt),
        note: dto.note,
      },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'DOCUMENT_CREATED',
      entityType: 'WorkerDocument',
      entityId: row.id,
      payload: {
        userId: row.userId,
        type: row.type,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      },
    });
    return serializeDoc(row);
  }

  async listMachine(actor: AuthUser, query: DocsListQueryDto) {
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.machineDocument.findMany({
        where: { companyId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.machineDocument.count({ where: { companyId } }),
    ]);
    return listResult(rows.map(serializeDoc), total, page, limit);
  }

  async createMachine(actor: AuthUser, dto: CreateMachineDocDto) {
    const companyId = requireCompany(actor);
    assertStoragePath(dto.filePath, companyId);
    const machine = await this.prisma.machine.findFirst({
      where: { id: dto.machineId, companyId },
    });
    if (!machine) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Invalid machineId',
        400,
      );
    }
    const row = await this.prisma.machineDocument.create({
      data: {
        companyId,
        machineId: dto.machineId,
        type: dto.type,
        filePath: dto.filePath,
        expiresAt: parseExpires(dto.expiresAt),
        note: dto.note,
      },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'DOCUMENT_CREATED',
      entityType: 'MachineDocument',
      entityId: row.id,
      payload: {
        machineId: row.machineId,
        type: row.type,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      },
    });
    return serializeDoc(row);
  }
}

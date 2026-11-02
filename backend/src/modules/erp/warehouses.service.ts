import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { requireCompany } from '../users/users-helpers';
import { CreateWarehouseDto, WarehouseQueryDto } from './warehouses.dto';
import { serializeWarehouse } from './serialize-erp';

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthUser, query: WarehouseQueryDto) {
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.WarehouseWhereInput = {
      companyId,
      ...(query.type ? { type: query.type } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.warehouse.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.warehouse.count({ where }),
    ]);
    return listResult(rows.map(serializeWarehouse), total, page, limit);
  }

  async create(actor: AuthUser, dto: CreateWarehouseDto) {
    const companyId = requireCompany(actor);
    if (dto.type !== 'SITE' && dto.projectId) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'projectId only allowed on SITE',
        400,
      );
    }
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, companyId },
      });
      if (!project) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Project not found', 404);
      }
    }
    const row = await this.prisma.warehouse.create({
      data: {
        companyId,
        name: dto.name,
        type: dto.type,
        projectId: dto.projectId ?? null,
      },
    });
    return serializeWarehouse(row);
  }

  async getById(actor: AuthUser, id: string) {
    const row = await this.prisma.warehouse.findFirst({
      where: { id, companyId: requireCompany(actor) },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Warehouse not found', 404);
    }
    return serializeWarehouse(row);
  }
}

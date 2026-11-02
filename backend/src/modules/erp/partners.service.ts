import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { requireCompany } from '../users/users-helpers';
import {
  CreatePartnerDto,
  PartnerQueryDto,
  PatchPartnerDto,
} from './partners.dto';
import { serializePartner } from './serialize-erp';

@Injectable()
export class PartnersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthUser, query: PartnerQueryDto) {
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.PartnerWhereInput = {
      companyId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.q ? { name: { contains: query.q } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.partner.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.partner.count({ where }),
    ]);
    return listResult(rows.map(serializePartner), total, page, limit);
  }

  async create(actor: AuthUser, dto: CreatePartnerDto) {
    const row = await this.prisma.partner.create({
      data: {
        companyId: requireCompany(actor),
        type: dto.type,
        name: dto.name,
        taxId: dto.taxId,
        note: dto.note,
      },
    });
    return serializePartner(row);
  }

  async getById(actor: AuthUser, id: string) {
    return serializePartner(await this.load(actor, id));
  }

  async patch(actor: AuthUser, id: string, dto: PatchPartnerDto) {
    await this.load(actor, id);
    const row = await this.prisma.partner.update({
      where: { id },
      data: {
        type: dto.type,
        name: dto.name,
        taxId: dto.taxId,
        note: dto.note,
        isActive: dto.isActive,
      },
    });
    return serializePartner(row);
  }

  private async load(actor: AuthUser, id: string) {
    const row = await this.prisma.partner.findFirst({
      where: { id, companyId: requireCompany(actor) },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Partner not found', 404);
    }
    return row;
  }
}

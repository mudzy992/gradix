import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthTokensService } from '../auth/auth-tokens.service';
import { TimerForceCloseService } from '../ops/timer-force-close.service';
import { AuthUser } from '../../common/types/auth-user';
import { CreateCompanyDto, PatchCompanyDto } from './companies.dto';
import { defaultSettingRows } from './default-settings';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { assertSlug } from '../../common/utils/slug';
import { readUniqueTarget } from '../../common/utils/prisma-errors';
import { requireTenantCompany } from '../../common/scope/tenant';
import { normalizePhone } from '../../common/utils/phone';
import {
  createTemporaryPassword,
  hashPassword,
} from '../../common/utils/password';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  slug: true,
  isActive: true,
  legalName: true,
  address: true,
  city: true,
  country: true,
  taxId: true,
  phone: true,
  email: true,
  logoPath: true,
  logoAssetId: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: AuthTokensService,
    private readonly timers: TimerForceCloseService,
  ) {}

  async list(query: PaginationQueryDto) {
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: PUBLIC_FIELDS,
      }),
      this.prisma.company.count(),
    ]);
    return listResult(rows, total, page, limit);
  }

  async create(actor: AuthUser, dto: CreateCompanyDto) {
    const slug = assertSlug(dto.slug);
    const temporaryPassword = createTemporaryPassword();
    try {
      const company = await this.prisma.$transaction(async (tx) => {
        const created = await tx.company.create({
          data: {
            name: dto.name,
            slug,
            legalName: dto.legalName,
            address: dto.address,
            city: dto.city,
            country: dto.country ?? 'BA',
            taxId: dto.taxId,
            phone: normalizePhone(dto.phone),
            email: dto.email?.toLowerCase(),
          },
        });
        await tx.setting.createMany({ data: defaultSettingRows(created.id) });
        await tx.user.create({
          data: {
            email: dto.admin.email.toLowerCase(),
            firstName: dto.admin.firstName,
            lastName: dto.admin.lastName,
            phone: normalizePhone(dto.admin.phone),
            companyId: created.id,
            mustChangePassword: true,
            passwordHash: await hashPassword(temporaryPassword),
            roles: { create: { role: 'SUPER_ADMIN' } },
          },
        });
        return created;
      });
      await this.audit.write({
        companyId: company.id,
        actorId: actor.id,
        action: 'COMPANY_CREATED',
        entityType: 'Company',
        entityId: company.id,
        payload: { slug: company.slug },
      });
      return { ...company, temporaryPassword };
    } catch (error) {
      this.throwUnique(error);
    }
  }

  async patchPlatform(actor: AuthUser, id: string, dto: PatchCompanyDto) {
    return this.patchCompany(actor, id, dto, true);
  }

  async getTenant(actor: AuthUser) {
    const companyId = this.requireTenant(actor);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: PUBLIC_FIELDS,
    });
    if (!company) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Company not found', 404);
    }
    return company;
  }

  async patchTenant(actor: AuthUser, dto: PatchCompanyDto) {
    return this.patchCompany(actor, this.requireTenant(actor), dto, false);
  }

  private requireTenant(actor: AuthUser): string {
    return requireTenantCompany(actor);
  }

  private async patchCompany(
    actor: AuthUser,
    id: string,
    dto: PatchCompanyDto,
    allowActive: boolean,
  ) {
    if (dto.slug !== undefined) {
      throw new AppError(
        ERROR_CODES.TENANT_SLUG_IMMUTABLE,
        'Slug cannot be changed',
        409,
      );
    }
    if (dto.isActive !== undefined && !allowActive) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'isActive requires platform access',
        403,
      );
    }
    const existing = await this.prisma.company.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Company not found', 404);
    }
    const company = await this.prisma.company.update({
      where: { id },
      data: {
        name: dto.name,
        legalName: dto.legalName,
        address: dto.address,
        city: dto.city,
        country: dto.country,
        taxId: dto.taxId,
        phone: dto.phone !== undefined ? normalizePhone(dto.phone) : undefined,
        email: dto.email?.toLowerCase(),
        logoPath: dto.logoPath,
        isActive: allowActive ? dto.isActive : undefined,
      },
    });
    if (allowActive && dto.isActive === false && existing.isActive) {
      await this.timers.closeOpenForCompany(id, actor.id);
      const users = await this.prisma.user.findMany({
        where: { companyId: id },
      });
      await Promise.all(users.map((user) => this.tokens.revokeAll(user.id)));
      await this.audit.write({
        companyId: id,
        actorId: actor.id,
        action: 'COMPANY_DEACTIVATED',
        entityType: 'Company',
        entityId: id,
        payload: {},
      });
    } else {
      await this.audit.write({
        companyId: id,
        actorId: actor.id,
        action: 'COMPANY_UPDATED',
        entityType: 'Company',
        entityId: id,
        payload: { fields: Object.keys(dto) },
      });
    }
    return company;
  }

  private throwUnique(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = readUniqueTarget(error.meta);
      if (target.includes('slug')) {
        throw new AppError(ERROR_CODES.CONFLICT, 'Slug already taken', 409);
      }
      if (target.includes('email')) {
        throw new AppError(
          ERROR_CODES.AUTH_EMAIL_TAKEN,
          'Email already taken',
          409,
        );
      }
      throw new AppError(ERROR_CODES.CONFLICT, 'Conflict', 409);
    }
    throw error;
  }
}

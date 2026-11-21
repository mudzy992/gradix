import { parseDecimal } from '../../common/utils/decimal-input';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthTokensService } from '../auth/auth-tokens.service';
import { TimerForceCloseService } from '../ops/timer-force-close.service';
import { AuthUser } from '../../common/types/auth-user';
import { CreateUserDto, PatchUserDto } from './users.dto';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  createTemporaryPassword,
  hashPassword,
} from '../../common/utils/password';
import { normalizePhone } from '../../common/utils/phone';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { serializeUser } from './serialize-user';
import {
  assertCanManageTarget,
  assertNotLastSuper,
  assertRoleChange,
} from './role-escalation';
import { UsersQueryDto } from './users.dto';
import {
  assertEmployeeCode,
  assertName,
  assertPayrollWrite,
  findScopedUser,
  requireCompany,
  throwUnique,
} from './users-helpers';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: AuthTokensService,
    private readonly timers: TimerForceCloseService,
  ) {}

  async list(actor: AuthUser, query: UsersQueryDto) {
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.UserWhereInput = {
      companyId,
      ...(query.role ? { roles: { some: { role: query.role } } } : {}),
      ...(query.q
        ? {
            OR: [
              { firstName: { contains: query.q, mode: 'insensitive' } },
              { lastName: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
              { employeeCode: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: { roles: true },
        skip,
        take: limit,
        orderBy: { createdAt: query.order ?? 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return listResult(
      rows.map((row) => serializeUser(row, actor)),
      total,
      page,
      limit,
    );
  }

  async getById(actor: AuthUser, id: string) {
    return serializeUser(await findScopedUser(this.prisma, actor, id), actor);
  }

  async create(actor: AuthUser, dto: CreateUserDto) {
    const companyId = requireCompany(actor);
    assertName(dto.firstName);
    assertName(dto.lastName);
    await assertRoleChange({
      actor,
      targetUserId: '',
      nextRoles: dto.roles,
      prisma: this.prisma,
    });
    assertEmployeeCode(dto.employeeCode);
    if (dto.hourlyRate !== undefined) {
      assertPayrollWrite(actor);
    }
    const temporaryPassword = createTemporaryPassword();
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: normalizePhone(dto.phone),
          employeeCode: dto.employeeCode || null,
          companyId,
          hourlyRate:
            dto.hourlyRate == null
              ? null
              : parseDecimal(dto.hourlyRate, 'hourlyRate', 2),
          locale: dto.locale === 'en' ? 'en' : 'bs',
          mustChangePassword: true,
          passwordHash: await hashPassword(temporaryPassword),
          roles: { create: dto.roles.map((role) => ({ role })) },
        },
        include: { roles: true },
      });
      await this.audit.write({
        companyId,
        actorId: actor.id,
        action: 'USER_CREATED',
        entityType: 'User',
        entityId: user.id,
        payload: { email: user.email, roles: dto.roles },
      });
      return { ...serializeUser(user, actor), temporaryPassword };
    } catch (error) {
      throwUnique(error);
    }
  }

  async patch(actor: AuthUser, id: string, dto: PatchUserDto) {
    const existing = await findScopedUser(this.prisma, actor, id);
    // BE-03: ne diraj nalog sa višom rolom (ADMIN ne mijenja SUPER_ADMIN-a).
    assertCanManageTarget(
      actor,
      existing.roles.map((item) => item.role),
    );
    if (dto.hourlyRate !== undefined) {
      assertPayrollWrite(actor);
    }
    assertName(dto.firstName);
    assertName(dto.lastName);
    assertEmployeeCode(dto.employeeCode);
    try {
      const { user, deactivated } = await this.prisma.$transaction(
        async (tx) => {
          // Role and status changes affect the company-wide active-super count.
          // Company -> User matches auth/deactivation lock order.
          const companyId = requireCompany(actor);
          if (dto.roles || dto.isActive !== undefined) {
            await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR UPDATE`;
          }
          await this.tokens.lockUser(tx, id);
          const current = await tx.user.findFirst({
            where: { id, companyId },
            include: { roles: true },
          });
          if (!current) {
            throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
          }
          assertCanManageTarget(
            actor,
            current.roles.map((item) => item.role),
          );
          if (dto.roles) {
            await assertRoleChange({
              actor,
              targetUserId: id,
              nextRoles: dto.roles,
              prisma: tx,
            });
          }
          if (
            dto.isActive === false &&
            current.roles.some((item) => item.role === 'SUPER_ADMIN')
          ) {
            await assertNotLastSuper(tx, id);
          }
          if (dto.roles) {
            await tx.userRoleAssignment.deleteMany({ where: { userId: id } });
            await tx.userRoleAssignment.createMany({
              data: dto.roles.map((role) => ({ userId: id, role })),
            });
          }
          const updated = await tx.user.update({
            where: { id },
            data: {
              firstName: dto.firstName,
              lastName: dto.lastName,
              phone:
                dto.phone !== undefined ? normalizePhone(dto.phone) : undefined,
              employeeCode:
                dto.employeeCode === undefined
                  ? undefined
                  : dto.employeeCode || null,
              isActive: dto.isActive,
              hourlyRate:
                dto.hourlyRate == null
                  ? dto.hourlyRate
                  : parseDecimal(dto.hourlyRate, 'hourlyRate', 2),
              locale: dto.locale,
            },
            include: { roles: true },
          });
          if (dto.isActive === false) {
            await this.tokens.revokeAllInTransaction(tx, id);
          }
          return {
            user: updated,
            deactivated: dto.isActive === false && current.isActive,
          };
        },
      );
      if (deactivated) {
        await this.audit.write({
          companyId: actor.tenantCompanyId,
          actorId: actor.id,
          action: 'USER_DEACTIVATED',
          entityType: 'User',
          entityId: id,
          payload: {},
        });
      } else {
        await this.audit.write({
          companyId: actor.tenantCompanyId,
          actorId: actor.id,
          action: dto.roles ? 'USER_ROLES_CHANGED' : 'USER_UPDATED',
          entityType: 'User',
          entityId: id,
          payload: { fields: Object.keys(dto) },
        });
      }
      // Retry timer cleanup even when the user was already inactive, since the
      // earlier post-commit cleanup may have failed. Session revocation has
      // already committed and does not depend on these external side effects.
      if (dto.isActive === false) {
        await this.timers.closeOpenForUser(id, actor.id);
      }
      return serializeUser(user, actor);
    } catch (error) {
      throwUnique(error);
    }
  }

  async resetPassword(actor: AuthUser, id: string) {
    if (actor.id === id) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Use change-password for self',
        403,
      );
    }
    const target = await findScopedUser(this.prisma, actor, id);
    // BE-03: reset tuđe lozinke je preuzimanje naloga — zabranjeno iznad svoje role.
    assertCanManageTarget(
      actor,
      target.roles.map((item) => item.role),
    );
    const temporaryPassword = createTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await this.prisma.$transaction(async (tx) => {
      await this.tokens.lockUser(tx, id);
      // The target may have moved tenant or gained a higher role while the
      // password was being hashed or this transaction waited for the lock.
      const current = await tx.user.findFirst({
        where: { id, companyId: requireCompany(actor) },
        include: { roles: true },
      });
      if (!current) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
      }
      assertCanManageTarget(
        actor,
        current.roles.map((item) => item.role),
      );
      await tx.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true },
      });
      await this.tokens.revokeAllInTransaction(tx, id);
    });
    await this.audit.write({
      companyId: actor.tenantCompanyId,
      actorId: actor.id,
      action: 'PASSWORD_RESET',
      entityType: 'User',
      entityId: id,
      payload: {},
    });
    return { temporaryPassword };
  }
}

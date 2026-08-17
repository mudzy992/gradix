import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthTokensService } from './auth-tokens.service';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { hashPassword, verifyPassword } from '../../common/utils/password';
import { mapAuthUser, toMeDto } from './map-auth-user';
import { AuthUser } from '../../common/types/auth-user';
import { ChangePasswordDto, FcmTokenDto, LoginDto, PatchMeDto } from './auth.dto';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../mail/email.service';

const USER_INCLUDE = { roles: true, company: true } as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AuthTokensService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.findLoginUser(dto);
    if (!user) {
      throw this.invalid();
    }
    const matches = await verifyPassword(user.passwordHash, dto.password);
    if (!matches) {
      throw this.invalid();
    }
    if (!user.isActive) {
      throw new AppError(ERROR_CODES.AUTH_ACCOUNT_INACTIVE, 'Account inactive', 401);
    }
    if (user.roles.length === 0) {
      throw this.invalid();
    }
    if (user.company && !user.company.isActive) {
      throw new AppError(
        ERROR_CODES.AUTH_COMPANY_INACTIVE,
        'Company inactive',
        401,
      );
    }
    const pair = await this.tokens.issuePair(user.id);
    return { ...pair, user: toMeDto(mapAuthUser(user, user.companyId)) };
  }

  async changePassword(actor: AuthUser, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!user || !(await verifyPassword(user.passwordHash, dto.currentPassword))) {
      throw this.invalid();
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.user.update({
      where: { id: actor.id },
      data: { passwordHash, mustChangePassword: false },
    });
    await this.tokens.revokeAll(actor.id);
    await this.audit.write({
      companyId: actor.companyId,
      actorId: actor.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: actor.id,
      payload: {},
    });
    return { ok: true };
  }

  async patchMe(actor: AuthUser, dto: PatchMeDto) {
    this.assertName(dto.firstName);
    this.assertName(dto.lastName);
    if (dto.locale && dto.locale !== 'bs' && dto.locale !== 'en') {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'locale must be bs or en', 400);
    }
    const user = await this.prisma.user.update({
      where: { id: actor.id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        locale: dto.locale,
      },
      include: USER_INCLUDE,
    });
    return toMeDto(mapAuthUser(user, actor.tenantCompanyId));
  }

  async upsertFcm(actor: AuthUser, dto: FcmTokenDto) {
    await this.prisma.device.upsert({
      where: { userId_deviceId: { userId: actor.id, deviceId: dto.deviceId } },
      create: {
        userId: actor.id,
        deviceId: dto.deviceId,
        fcmToken: dto.fcmToken,
        lastSeenAt: new Date(),
      },
      update: { fcmToken: dto.fcmToken, lastSeenAt: new Date() },
    });
    return { ok: true };
  }

  async forgot(email: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user?.companyId) {
      await this.email.trySend({
        companyId: user.companyId,
        to: user.email,
        subject: 'Password reset',
        text: 'A password reset was requested.',
      });
    }
    return { ok: true };
  }

  reset(): { ok: true } {
    return { ok: true };
  }

  private async findLoginUser(dto: LoginDto) {
    if (dto.email) {
      return this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
        include: USER_INCLUDE,
      });
    }
    if (dto.phone) {
      return this.prisma.user.findUnique({
        where: { phone: dto.phone },
        include: USER_INCLUDE,
      });
    }
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'email or phone required', 400);
  }

  private invalid(): AppError {
    return new AppError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Invalid credentials', 401);
  }

  private assertName(value?: string): void {
    if (value === undefined) {
      return;
    }
    if (value.length < 1 || value.length > 80) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Name must be 1–80 characters', 400);
    }
  }
}

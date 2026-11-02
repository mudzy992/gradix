import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import {
  createRefreshToken,
  hashRefreshToken,
} from '../../common/utils/password';
import { REFRESH_DAYS, REFRESH_RETENTION_DAYS } from '../../common/constants';
import { AppError } from '../../common/errors/app-error';
import { evaluateRefreshToken } from './auth-token-rules';
import { ERROR_CODES } from '../../common/errors/error-codes';

@Injectable()
export class AuthTokensService {
  private readonly logger = new Logger(AuthTokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async issuePair(userId: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const accessToken = this.jwt.sign({ sub: userId });
    const refreshToken = createRefreshToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_DAYS);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt,
      },
    });
    return { accessToken, refreshToken };
  }

  async rotate(refreshToken: string) {
    const tokenHash = hashRefreshToken(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { roles: true, company: true } } },
    });

    const verdict = evaluateRefreshToken(
      existing,
      existing?.user
        ? {
            isActive: existing.user.isActive,
            roles: existing.user.roles.map((item) => item.role),
            company: existing.user.company,
          }
        : null,
    );

    if (verdict === 'reuse') {
      // Ponovna upotreba već rotiranog tokena = znak krađe → gasimo sve sesije.
      await this.revokeAll(existing!.userId);
      throw new AppError(
        ERROR_CODES.AUTH_REFRESH_REUSE,
        'Refresh token reuse detected',
        401,
      );
    }
    if (verdict === 'inactive') {
      await this.revokeAll(existing!.userId);
      throw new AppError(
        ERROR_CODES.AUTH_ACCOUNT_INACTIVE,
        'Account inactive',
        401,
      );
    }
    if (verdict === 'company-inactive') {
      await this.revokeAll(existing!.userId);
      throw new AppError(
        ERROR_CODES.AUTH_COMPANY_INACTIVE,
        'Company inactive',
        401,
      );
    }
    if (verdict === 'no-roles') {
      await this.revokeAll(existing!.userId);
      throw this.invalid();
    }
    if (verdict !== 'ok') {
      throw this.invalid();
    }

    await this.prisma.refreshToken.update({
      where: { id: existing!.id },
      data: { revokedAt: new Date() },
    });
    return this.issuePair(existing!.userId);
  }

  /**
   * Interna greška sa istom porukom kao neuspješna prijava — ne odaje da li token
   * postoji, samo da ne važi.
   */
  private invalid(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      'Invalid credentials',
      401,
    );
  }

  /**
   * Čišćenje isteklih/opozvanih refresh tokena (BE-02). Bez ovoga tabela raste
   * zauvek, a `tokenHash` unique indeks se puni mrtvim zapisima.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    disabled: Boolean(process.env.JEST_WORKER_ID),
  })
  async cleanupExpired(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - REFRESH_RETENTION_DAYS);
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
      },
    });
    if (count > 0) {
      this.logger.log(`Obrisano ${count} isteklih refresh tokena`);
    }
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

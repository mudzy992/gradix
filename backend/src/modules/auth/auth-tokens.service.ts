import { randomUUID } from 'crypto';
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
import type { Prisma } from '../../../generated/client';

@Injectable()
export class AuthTokensService {
  private readonly logger = new Logger(AuthTokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // Issuance, rotation and revocation for one user take the same row lock.
  // Keep the order User -> RefreshToken to avoid issuing a child after a
  // concurrently started revokeAll has taken its statement snapshot.
  async lockUser(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  }

  // Caller must hold this user's row lock for the lifetime of the transaction.
  async revokeAllInTransaction(tx: Prisma.TransactionClient, userId: string) {
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async issuePair(
    userId: string,
    verifiedPasswordHash: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const accessToken = this.jwt.sign({ sub: userId });
    const refreshToken = createRefreshToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_DAYS);
    await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      // Password verification happened before the lock. Do not issue a token
      // if a reset or account change committed in the meantime.
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { roles: true, company: true },
      });
      if (!user || user.passwordHash !== verifiedPasswordHash) {
        throw this.invalid();
      }
      if (!user.isActive) {
        throw new AppError(
          ERROR_CODES.AUTH_ACCOUNT_INACTIVE,
          'Account inactive',
          401,
        );
      }
      if (!user.roles.length) throw this.invalid();
      if (user.company && !user.company.isActive) {
        throw new AppError(
          ERROR_CODES.AUTH_COMPANY_INACTIVE,
          'Company inactive',
          401,
        );
      }
      await tx.refreshToken.create({
        data: {
          userId,
          tokenHash: hashRefreshToken(refreshToken),
          lineageKey: randomUUID(),
          expiresAt,
        },
      });
    });
    return { accessToken, refreshToken };
  }

  async rotate(refreshToken: string) {
    const tokenHash = hashRefreshToken(refreshToken);
    // This preliminary lookup identifies the lock only; all security checks
    // are repeated after acquiring it inside the transaction.
    const initial = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!initial) throw this.invalid();

    const nextRefreshToken = createRefreshToken();
    const accessToken = this.jwt.sign({ sub: initial.userId });
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, initial.userId);
      const existing = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: { include: { roles: true, company: true } } },
      });
      if (existing && existing.userId !== initial.userId) return 'invalid';
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
      if (verdict !== 'ok') {
        if (verdict !== 'invalid') {
          await this.revokeAllInTransaction(tx, initial.userId);
        }
        return verdict;
      }
      const now = new Date();
      const expiresAt = new Date(now);
      expiresAt.setDate(expiresAt.getDate() + REFRESH_DAYS);
      // Old rows have no family yet. Establish one on their first rotation
      // without changing legacy rows or relying on another process to migrate.
      const lineageKey = existing!.lineageKey ?? existing!.id;
      const consumed = await tx.refreshToken.updateMany({
        where: { id: existing!.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now, lineageKey },
      });
      if (consumed.count !== 1) {
        const current = await tx.refreshToken.findUnique({
          where: { id: existing!.id },
          select: { revokedAt: true },
        });
        if (current?.revokedAt) {
          await this.revokeAllInTransaction(tx, initial.userId);
          return 'reuse';
        }
        return 'invalid';
      }
      await tx.refreshToken.create({
        data: {
          userId: initial.userId,
          tokenHash: hashRefreshToken(nextRefreshToken),
          lineageKey,
          expiresAt,
        },
      });
      return 'ok';
    });
    // Throw only after commit: reuse/inactive verdicts must keep the revocation.
    if (result === 'reuse') {
      throw new AppError(
        ERROR_CODES.AUTH_REFRESH_REUSE,
        'Refresh token reuse detected',
        401,
      );
    }
    if (result === 'inactive') {
      throw new AppError(
        ERROR_CODES.AUTH_ACCOUNT_INACTIVE,
        'Account inactive',
        401,
      );
    }
    if (result === 'company-inactive') {
      throw new AppError(
        ERROR_CODES.AUTH_COMPANY_INACTIVE,
        'Company inactive',
        401,
      );
    }
    if (result !== 'ok') throw this.invalid();
    return { accessToken, refreshToken: nextRefreshToken };
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

  /** Atomically replace the password and revoke all existing refresh sessions. */
  async replacePassword(
    userId: string,
    passwordHash: string,
    mustChangePassword: boolean,
    expectedHash?: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const updated = await tx.user.updateMany({
        where: {
          id: userId,
          ...(expectedHash !== undefined ? { passwordHash: expectedHash } : {}),
        },
        data: { passwordHash, mustChangePassword },
      });
      if (updated.count !== 1) return false;
      await this.revokeAllInTransaction(tx, userId);
      return true;
    });
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(refreshToken) },
        select: { id: true, userId: true, lineageKey: true },
      });
      if (!token || token.userId !== userId) return;
      await tx.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          OR: token.lineageKey
            ? [{ id: token.id }, { lineageKey: token.lineageKey }]
            : [{ id: token.id }],
        },
        data: { revokedAt: new Date() },
      });
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      await this.revokeAllInTransaction(tx, userId);
    });
  }
}

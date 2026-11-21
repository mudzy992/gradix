import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
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
import {
  deriveRefreshSuccessor,
  isWithinRefreshReplayWindow,
  RefreshReplayClock,
  safeRefreshHashEqual,
  REFRESH_REPLAY_MAX_RETRIES,
} from './auth-refresh-replay';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { Prisma } from '../../../generated/client';

@Injectable()
export class AuthTokensService {
  private readonly logger = new Logger(AuthTokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly replayClock: RefreshReplayClock,
  ) {}

  // Issuance/rotation lock Company (SHARE) -> User -> RefreshToken.
  // Per-user revocations start at User; company deactivation locks Company
  // exclusively and then tokens, never User, to avoid a lock-order cycle.
  async lockUser(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  }

  private async lockCompanyForIssuance(
    tx: Prisma.TransactionClient,
    companyId: string | null,
  ) {
    if (companyId) {
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR SHARE`;
    }
  }

  // Caller must hold the company row FOR UPDATE until commit.
  async revokeCompanyInTransaction(
    tx: Prisma.TransactionClient,
    companyId: string,
  ) {
    await tx.refreshToken.updateMany({
      where: { user: { companyId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
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
    const initial = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!initial) throw this.invalid();
    const accessToken = this.jwt.sign({ sub: userId });
    const refreshToken = createRefreshToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_DAYS);
    await this.prisma.$transaction(async (tx) => {
      await this.lockCompanyForIssuance(tx, initial.companyId);
      await this.lockUser(tx, userId);
      // Password verification happened before the lock. Do not issue a token
      // if a reset or account change committed in the meantime.
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { roles: true, company: true },
      });
      if (
        !user ||
        user.companyId !== initial.companyId ||
        user.passwordHash !== verifiedPasswordHash
      ) {
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
      select: { userId: true, user: { select: { companyId: true } } },
    });
    if (!initial) throw this.invalid();

    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockCompanyForIssuance(tx, initial.user.companyId);
      await this.lockUser(tx, initial.userId);
      const existing = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: { include: { roles: true, company: true } } },
      });
      if (
        existing &&
        (existing.userId !== initial.userId ||
          existing.user.companyId !== initial.user.companyId)
      )
        return 'invalid';
      // Use the database clock *after* waiting for the user lock so concurrent
      // replicas agree on the rotation instant and replay window.
      const now = await this.replayClock.now(tx);
      if (!existing) return 'invalid';
      const lineageKey = existing.lineageKey ?? existing.id;
      const nextRefreshToken = deriveRefreshSuccessor(
        refreshToken,
        this.config.getOrThrow<string>('REFRESH_REPLAY_SECRET'),
        lineageKey,
        existing.generation,
      );
      const owner = existing?.user
        ? {
            isActive: existing.user.isActive,
            roles: existing.user.roles.map((item) => item.role),
            company: existing.user.company,
          }
        : null;
      if (existing?.revokedAt) {
        if (isWithinRefreshReplayWindow(existing.revokedAt, now)) {
          const eligible =
            evaluateRefreshToken(
              { ...existing, revokedAt: null },
              owner,
              now,
            ) === 'ok';
          if (eligible && existing.lineageKey) {
            const child = await tx.refreshToken.findFirst({
              where: {
                userId: existing.userId,
                lineageKey: existing.lineageKey,
                generation: existing.generation + 1,
                revokedAt: null,
              },
            });
            if (
              child &&
              safeRefreshHashEqual(
                child.tokenHash,
                hashRefreshToken(nextRefreshToken),
              ) &&
              child.userId === existing.userId &&
              child.lineageKey === existing.lineageKey &&
              !child.revokedAt &&
              child.expiresAt.getTime() > now.getTime() &&
              existing.replayCount < REFRESH_REPLAY_MAX_RETRIES
            ) {
              // The user row lock serializes retries across replicas. Rejected
              // replays do not revoke the still-valid successor.
              await tx.refreshToken.update({
                where: { id: existing.id },
                data: { replayCount: { increment: 1 } },
              });
              return { issuedAt: existing.revokedAt, nextRefreshToken };
            }
          }
          // Logout, expired/rotated child, legacy tokens or key rotation must
          // not resurrect a credential or revoke an unrelated session.
          return 'reuse-no-revoke';
        }
        if (existing.lineageKey) {
          await tx.refreshToken.updateMany({
            where: {
              userId: initial.userId,
              lineageKey: existing.lineageKey,
              revokedAt: null,
            },
            data: { revokedAt: now },
          });
        } else {
          // Pre-family legacy rows cannot be scoped safely.
          await this.revokeAllInTransaction(tx, initial.userId);
        }
        return 'reuse';
      }
      const verdict = evaluateRefreshToken(existing, owner, now);
      if (verdict !== 'ok') {
        if (verdict !== 'invalid') {
          await this.revokeAllInTransaction(tx, initial.userId);
        }
        return verdict;
      }
      // Each successor inherits the parent's deadline; rotation and replay can
      // never extend the lifetime granted to the currently presented token.
      const expiresAt = existing.expiresAt;
      // Old rows have no family yet. Establish one on their first rotation
      // without changing legacy rows or relying on another process to migrate.
      const consumed = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now, lineageKey },
      });
      if (consumed.count !== 1) {
        const current = await tx.refreshToken.findUnique({
          where: { id: existing.id },
          select: { revokedAt: true },
        });
        if (current?.revokedAt) {
          return 'reuse-no-revoke';
        }
        return 'invalid';
      }
      await tx.refreshToken.create({
        data: {
          userId: initial.userId,
          tokenHash: hashRefreshToken(nextRefreshToken),
          lineageKey,
          generation: existing.generation + 1,
          expiresAt,
        },
      });
      return { issuedAt: now, nextRefreshToken };
    });
    // Throw only after commit: reuse/inactive verdicts must keep the revocation.
    if (result === 'reuse' || result === 'reuse-no-revoke') {
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
    if (typeof result !== 'object') throw this.invalid();
    const accessToken = this.jwt.sign({
      sub: initial.userId,
      iat: Math.floor(result.issuedAt.getTime() / 1000),
    });
    return { accessToken, refreshToken: result.nextRefreshToken };
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

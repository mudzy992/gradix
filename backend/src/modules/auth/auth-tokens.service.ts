import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import {
  createRefreshToken,
  hashRefreshToken,
} from '../../common/utils/password';
import { REFRESH_DAYS } from '../../common/constants';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

@Injectable()
export class AuthTokensService {
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
    });
    if (!existing) {
      throw new AppError(
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        'Invalid credentials',
        401,
      );
    }
    if (existing.revokedAt) {
      await this.revokeAll(existing.userId);
      throw new AppError(
        ERROR_CODES.AUTH_REFRESH_REUSE,
        'Refresh token reuse detected',
        401,
      );
    }
    if (existing.expiresAt < new Date()) {
      throw new AppError(
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        'Invalid credentials',
        401,
      );
    }
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    return this.issuePair(existing.userId);
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

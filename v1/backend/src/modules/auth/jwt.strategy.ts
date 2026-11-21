import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { mapAuthUser } from './map-auth-user';
import { AuthUser } from '../../common/types/auth-user';

type JwtPayload = {
  sub: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { roles: true, company: true },
    });
    if (!user || !user.isActive) {
      throw new AppError(
        ERROR_CODES.AUTH_ACCOUNT_INACTIVE,
        'Account inactive',
        401,
      );
    }
    if (
      user.company &&
      !user.company.isActive &&
      !user.roles.some((item) => item.role === 'PLATFORM_ADMIN')
    ) {
      throw new AppError(
        ERROR_CODES.AUTH_COMPANY_INACTIVE,
        'Company inactive',
        401,
      );
    }
    return mapAuthUser(user, user.companyId);
  }
}

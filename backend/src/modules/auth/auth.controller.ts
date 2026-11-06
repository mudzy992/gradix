import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthTokensService } from './auth-tokens.service';
import {
  ChangePasswordDto,
  ForgotDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  ResetDto,
} from './auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

/**
 * FE-11 (D-050): limiti su isti kao prije (5/min za prijavu, 20/min za refresh), ali se u E2E poslu
 * mogu podići — Playwright sa `retries: 1` ponovo izvršava `beforeAll`, tj. novu prijavu, pa bi
 * četvrta prijava u minuti vratila 429 i test bi pao na „element nije nađen“.
 */
const LOGIN_LIMIT = Number(process.env.AUTH_LOGIN_LIMIT ?? 5);
const REFRESH_LIMIT = Number(process.env.AUTH_REFRESH_LIMIT ?? 20);

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: AuthTokensService,
  ) {}

  @Public()
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: 60000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Throttle({ default: { limit: REFRESH_LIMIT, ttl: 60000 } })
  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'For 20 seconds after rotation, up to two retries return the identical pair only while the direct successor and parent remain valid and the account is active. Additional retries are rejected without revoking the valid child. Rotation does not extend the refresh deadline. After the window reuse revokes the token family; legacy unlinked tokens can revoke all sessions. A stolen token can also be replayed during the window.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['refreshToken'],
      properties: {
        refreshToken: {
          type: 'string',
          description: 'Opaque bearer refresh token; never log or expose it.',
        },
      },
    },
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          required: ['accessToken', 'refreshToken'],
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid, expired, revoked or reused credential.',
    schema: {
      type: 'object',
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          required: ['code', 'message'],
          properties: { code: { type: 'string' }, message: { type: 'string' } },
        },
      },
    },
  })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.tokens.rotate(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('logout')
  async logout(@CurrentUser() user: AuthUser, @Body() dto: LogoutDto) {
    await this.tokens.logout(user.id, dto.refreshToken);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.tokens.revokeAll(user.id);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('change-password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user, dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @Post('forgot')
  forgot(@Body() dto: ForgotDto) {
    return this.auth.forgot(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @Post('reset')
  reset(@Body() _dto: ResetDto) {
    return this.auth.reset();
  }
}

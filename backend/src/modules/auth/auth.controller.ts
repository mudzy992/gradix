import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: AuthTokensService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
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
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user, dto);
  }

  @Public()
  @HttpCode(200)
  @Post('forgot')
  forgot(@Body() _dto: ForgotDto) {
    return this.auth.forgot();
  }

  @Public()
  @HttpCode(200)
  @Post('reset')
  reset(@Body() _dto: ResetDto) {
    return this.auth.reset();
  }
}

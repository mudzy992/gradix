import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { FcmTokenDto, PatchMeDto } from './auth.dto';
import { toMeDto } from './map-auth-user';

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  getMe(@CurrentUser() user: AuthUser) {
    return toMeDto(user);
  }

  @Patch()
  patchMe(@CurrentUser() user: AuthUser, @Body() dto: PatchMeDto) {
    return this.auth.patchMe(user, dto);
  }

  @Put('fcm-token')
  putFcm(@CurrentUser() user: AuthUser, @Body() dto: FcmTokenDto) {
    return this.auth.upsertFcm(user, dto);
  }
}

import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LocationsService } from './locations.service';
import { GeofenceCheckQueryDto, PingLocationDto } from './locations.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { USER_GPS_TTL_MS } from '../../common/constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Post('me')
  @Throttle({ default: { limit: 1, ttl: USER_GPS_TTL_MS } })
  pingMe(@CurrentUser() actor: AuthUser, @Body() dto: PingLocationDto) {
    return this.locations.pingMe(actor, dto);
  }

  @Get('geofence-check')
  geofenceCheck(
    @CurrentUser() actor: AuthUser,
    @Query() query: GeofenceCheckQueryDto,
  ) {
    return this.locations.geofenceCheck(actor, query);
  }
}

import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TripsService } from './trips.service';
import { CompleteTripDto, CreateTripDto, TripListQueryDto } from './trips.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query() query: TripListQueryDto) {
    return this.trips.list(actor, query);
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateTripDto) {
    return this.trips.create(actor, dto);
  }

  @Get(':id')
  getById(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.trips.getById(actor, id);
  }

  @Post(':id/complete')
  complete(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: CompleteTripDto,
  ) {
    return this.trips.complete(actor, id, dto);
  }
}

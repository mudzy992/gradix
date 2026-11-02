import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TripsService } from './trips.service';
import {
  CompleteTripDto,
  CreateTripDto,
  PatchTripDto,
  TripListQueryDto,
} from './trips.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
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

  @Patch(':id')
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchTripDto,
  ) {
    return this.trips.patch(actor, id, dto);
  }

  @Post(':id/complete')
  complete(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: CompleteTripDto,
  ) {
    return this.trips.complete(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @SkipEnvelope()
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.trips.remove(actor, id);
  }
}

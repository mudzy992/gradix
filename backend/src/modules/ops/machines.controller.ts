import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MachinesService } from './machines.service';
import { LocationsService } from './locations.service';
import {
  AssignMachineDto,
  CreateMachineDto,
  MachineListQueryDto,
  MachineLocationDto,
  PatchMachineDto,
} from './machines.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { Throttle } from '@nestjs/throttler';
import { MACHINE_GPS_TTL_MS } from '../../common/constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('machines')
export class MachinesController {
  constructor(
    private readonly machines: MachinesService,
    private readonly locations: LocationsService,
  ) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query() query: MachineListQueryDto) {
    return this.machines.list(actor, query);
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateMachineDto) {
    return this.machines.create(actor, dto);
  }

  @Get(':id')
  getById(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.machines.getById(actor, id);
  }

  @Patch(':id')
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchMachineDto,
  ) {
    return this.machines.patch(actor, id, dto);
  }

  @Delete(':id')
  decommission(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.machines.decommission(actor, id);
  }

  @Post(':id/assign')
  assign(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssignMachineDto,
  ) {
    return this.machines.assign(actor, id, dto);
  }

  @Post(':id/unassign')
  unassign(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.machines.unassign(actor, id);
  }

  @Post(':id/location')
  @Throttle({ default: { limit: 1, ttl: MACHINE_GPS_TTL_MS } })
  ping(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: MachineLocationDto,
  ) {
    return this.locations.pingMachine(actor, id, dto);
  }
}

import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { GpsDevicesService } from './gps-devices.service';
import { CreateGpsDeviceDto, PatchGpsDeviceDto } from './gps-devices.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('machines/:machineId/devices')
export class MachineDevicesController {
  constructor(private readonly devices: GpsDevicesService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Param('machineId') machineId: string) {
    return this.devices.list(actor, machineId);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Param('machineId') machineId: string,
    @Body() dto: CreateGpsDeviceDto,
  ) {
    return this.devices.create(actor, machineId, dto);
  }

  @Patch(':deviceId')
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('machineId') machineId: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: PatchGpsDeviceDto,
  ) {
    return this.devices.patch(actor, machineId, deviceId, dto);
  }

  @Post(':deviceId/rotate')
  rotate(
    @CurrentUser() actor: AuthUser,
    @Param('machineId') machineId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.devices.rotate(actor, machineId, deviceId);
  }
}

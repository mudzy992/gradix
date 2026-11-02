import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { hasRole, isCompanyWide } from '../../common/scope/ops-roles';
import { requireCompany } from '../users/users-helpers';
import { createDeviceApiKey, deviceKeyLookup, hashDeviceKey } from './iot-key';
import { serializeGpsDevice } from './serialize-gps-device';
import { CreateGpsDeviceDto, PatchGpsDeviceDto } from './gps-devices.dto';

@Injectable()
export class GpsDevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthUser, machineId: string) {
    await this.loadReadable(actor, machineId);
    const rows = await this.prisma.gpsDevice.findMany({ where: { machineId } });
    return rows.map(serializeGpsDevice);
  }

  async create(actor: AuthUser, machineId: string, dto: CreateGpsDeviceDto) {
    const machine = await this.loadWritable(actor, machineId);
    const apiKey = createDeviceApiKey();
    try {
      const row = await this.prisma.gpsDevice.create({
        data: {
          companyId: machine.companyId,
          machineId: machine.id,
          name: dto.name,
          apiKeyHash: await hashDeviceKey(apiKey),
          keyLookup: deviceKeyLookup(apiKey),
        },
      });
      return { ...serializeGpsDevice(row), apiKey };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          ERROR_CODES.IOT_DEVICE_EXISTS,
          'Machine already has a GPS device',
          409,
        );
      }
      throw error;
    }
  }

  async patch(
    actor: AuthUser,
    machineId: string,
    deviceId: string,
    dto: PatchGpsDeviceDto,
  ) {
    await this.loadWritable(actor, machineId);
    const device = await this.loadDevice(machineId, deviceId);
    const row = await this.prisma.gpsDevice.update({
      where: { id: device.id },
      data: { name: dto.name, isActive: dto.isActive },
    });
    return serializeGpsDevice(row);
  }

  async rotate(actor: AuthUser, machineId: string, deviceId: string) {
    await this.loadWritable(actor, machineId);
    const device = await this.loadDevice(machineId, deviceId);
    const apiKey = createDeviceApiKey();
    const row = await this.prisma.gpsDevice.update({
      where: { id: device.id },
      data: {
        apiKeyHash: await hashDeviceKey(apiKey),
        keyLookup: deviceKeyLookup(apiKey),
      },
    });
    return { ...serializeGpsDevice(row), apiKey };
  }

  private async loadReadable(actor: AuthUser, id: string) {
    if (!actor.permissions.includes('fleet.read')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Fleet read not allowed', 403);
    }
    const machine = await this.prisma.machine.findFirst({
      where: { id, companyId: requireCompany(actor) },
    });
    if (!machine) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Machine not found', 404);
    }
    return machine;
  }

  private async loadWritable(actor: AuthUser, id: string) {
    if (!actor.permissions.includes('fleet.write')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Fleet write not allowed', 403);
    }
    const machine = await this.loadReadable(actor, id);
    if (isCompanyWide(actor) || hasRole(actor, 'PROJECT_MANAGER')) {
      return machine;
    }
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Fleet write not allowed', 403);
  }

  private async loadDevice(machineId: string, deviceId: string) {
    const device = await this.prisma.gpsDevice.findFirst({
      where: { id: deviceId, machineId },
    });
    if (!device) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Device not found', 404);
    }
    return device;
  }
}

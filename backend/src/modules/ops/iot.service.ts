import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { parseLatLng } from '../../common/utils/geo';
import { verifyPassword } from '../../common/utils/password';
import { deviceKeyLookup } from './iot-key';
import { writeMachineGps } from './write-machine-gps';
import { IotGpsDto } from './iot.dto';

@Injectable()
export class IotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async ingest(rawKey: string | undefined, dto: IotGpsDto) {
    const device = await this.resolveDevice(rawKey);
    if (device.machine.status === 'DECOMMISSIONED' || !device.isActive) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Device is not allowed to ingest',
        403,
      );
    }
    // BE-09 (F-04): koordinate iz uređaja moraju biti u stvarnim granicama.
    const { lat, lng } = parseLatLng(dto.lat, dto.lng);
    const now = await writeMachineGps({
      prisma: this.prisma,
      realtime: this.realtime,
      companyId: device.companyId,
      machineId: device.machineId,
      lat,
      lng,
      source: 'IOT',
      throttle: true,
      lastGpsAt: device.machine.lastGpsAt,
    });
    await this.prisma.gpsDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: now },
    });
    return {
      id: device.machineId,
      lastLat: lat.toString(),
      lastLng: lng.toString(),
      lastGpsAt: now,
      lastGpsSource: 'IOT' as const,
    };
  }

  private async resolveDevice(rawKey: string | undefined) {
    if (!rawKey) {
      throw new AppError(
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        'Invalid credentials',
        401,
      );
    }
    const device = await this.prisma.gpsDevice.findUnique({
      where: { keyLookup: deviceKeyLookup(rawKey) },
      include: { machine: true },
    });
    if (!device || !(await verifyPassword(device.apiKeyHash, rawKey))) {
      throw new AppError(
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        'Invalid credentials',
        401,
      );
    }
    return device;
  }
}

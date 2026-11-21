import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from './trips.service';
import { FuelService } from './fuel.service';
import { CreateTripDto } from './trips.dto';
import { CreateFuelDto } from './fuel.dto';
import { SyncPushItemDto } from './sync.dto';
import {
  asOptionalString,
  asString,
  syncOk,
  validateSyncDecimalScale,
} from './sync-result';
import { requireCompany } from '../users/users-helpers';

@Injectable()
export class SyncPushFleetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
    private readonly fuel: FuelService,
  ) {}

  async pushTrip(actor: AuthUser, item: SyncPushItemDto) {
    if (!actor.permissions.includes(PERMISSIONS.TRIPS_WRITE)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Trips write not allowed', 403);
    }
    validateSyncDecimalScale(item.payload, {
      quantity: 3,
      weighQty: 3,
      originLat: 7,
      originLng: 7,
      destLat: 7,
      destLng: 7,
    });
    const existing = await this.prisma.trip.findFirst({
      where: {
        companyId: requireCompany(actor),
        driverId: actor.id,
        deviceId: item.deviceId,
        localId: item.localId,
      },
    });
    if (existing) {
      return syncOk(item.localId, 'TRIP', existing.id);
    }
    // BE-10 (F-06): jedan upis, bez `create` + `update` (pad između = duplikat pri retry-u).
    const created = await this.trips.create(
      actor,
      this.toTripDto(item.payload),
      { localId: item.localId, deviceId: item.deviceId },
    );
    return syncOk(item.localId, 'TRIP', created.id);
  }

  async pushFuel(actor: AuthUser, item: SyncPushItemDto) {
    if (!actor.permissions.includes(PERMISSIONS.FUEL_WRITE)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Fuel write not allowed', 403);
    }
    validateSyncDecimalScale(item.payload, { liters: 3, unitPrice: 2 });
    const existing = await this.prisma.fuelEntry.findFirst({
      where: {
        companyId: requireCompany(actor),
        userId: actor.id,
        deviceId: item.deviceId,
        localId: item.localId,
      },
    });
    if (existing) {
      return syncOk(item.localId, 'FUEL', existing.id);
    }
    const created = await this.fuel.create(
      actor,
      this.toFuelDto(item.payload),
      {
        localId: item.localId,
        deviceId: item.deviceId,
      },
    );
    return syncOk(item.localId, 'FUEL', created.id);
  }

  private toTripDto(payload: Record<string, unknown>): CreateTripDto {
    const dto = new CreateTripDto();
    dto.projectId = asString(payload.projectId, 'projectId');
    dto.machineId = asString(payload.machineId, 'machineId');
    dto.materialId = asString(payload.materialId, 'materialId');
    dto.quantity = asString(payload.quantity, 'quantity');
    dto.originText = asString(payload.originText, 'originText');
    dto.originLat = asOptionalString(payload.originLat);
    dto.originLng = asOptionalString(payload.originLng);
    dto.destDepotId = asOptionalString(payload.destDepotId);
    dto.destLat = asOptionalString(payload.destLat);
    dto.destLng = asOptionalString(payload.destLng);
    dto.weighTicketPath = asOptionalString(payload.weighTicketPath);
    dto.weighQty = asOptionalString(payload.weighQty);
    dto.notes = asOptionalString(payload.notes);
    return dto;
  }

  private toFuelDto(payload: Record<string, unknown>): CreateFuelDto {
    const dto = new CreateFuelDto();
    dto.machineId = asString(payload.machineId, 'machineId');
    dto.projectId = asOptionalString(payload.projectId);
    dto.liters = asString(payload.liters, 'liters');
    dto.unitPrice = asString(payload.unitPrice, 'unitPrice');
    dto.notes = asOptionalString(payload.notes);
    dto.receiptPath = asOptionalString(payload.receiptPath);
    return dto;
  }
}

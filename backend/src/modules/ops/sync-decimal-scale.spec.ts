import { SyncPushFleetService } from './sync-push-fleet';
import { SyncPushDiaryService } from './sync-push-diary';
import { SyncPushTimerService } from './sync-push-timer';
import { SyncService } from './sync.service';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';
import type { SyncPushItemDto } from './sync.dto';

const actor = {
  id: 'u',
  companyId: 'c',
  roles: ['ADMIN'],
  permissions: Object.values(PERMISSIONS),
} as unknown as AuthUser;
const item = (
  type: SyncPushItemDto['type'],
  field: string,
  value: string,
): SyncPushItemDto => ({
  type,
  localId: 'local-0001',
  deviceId: 'device-1',
  payload: { [field]: value },
});
describe('sync decimal scale is checked even on duplicate local ids', () => {
  const prisma = {
    trip: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }) },
    fuelEntry: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }) },
    diaryEntry: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }) },
  };
  const fleet = new SyncPushFleetService(
    prisma as never,
    {} as never,
    {} as never,
  );
  const diary = new SyncPushDiaryService(prisma as never, {} as never);
  const timer = new SyncPushTimerService(
    { findByLocalId: jest.fn().mockResolvedValue({ id: 'existing' }) } as never,
    {} as never,
  );
  it.each([
    ['TRIP', 'quantity', '0.0001'],
    ['TRIP', 'weighQty', '0.0001'],
    ['TRIP', 'originLat', '0.00000001'],
    ['TRIP', 'originLng', '0.00000001'],
    ['TRIP', 'destLat', '0.00000001'],
    ['TRIP', 'destLng', '0.00000001'],
    ['FUEL', 'liters', '0.0001'],
    ['FUEL', 'unitPrice', '0.001'],
    ['DIARY', 'tempMin', '0.01'],
    ['DIARY', 'tempMax', '0.01'],
    ['TIMER', 'lat', '0.00000001'],
    ['TIMER', 'lng', '0.00000001'],
  ] as const)('%s.%s rejects %s', async (type, field, value) => {
    const request = item(type, field, value);
    const promise =
      type === 'TRIP'
        ? fleet.pushTrip(actor, request)
        : type === 'FUEL'
          ? fleet.pushFuel(actor, request)
          : type === 'DIARY'
            ? diary.pushEntry(actor, request)
            : timer.push(actor, request);
    await expect(promise).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
  });
  it('rejects a whole batch before invoking any item when a later item has excess scale', async () => {
    const fleetHandler = { pushFuel: jest.fn(), pushTrip: jest.fn() };
    const service = new SyncService(
      {} as never,
      {} as never,
      fleetHandler as never,
      {} as never,
    );
    await expect(
      service.push(actor, {
        items: [
          item('FUEL', 'liters', '1.000'),
          item('TRIP', 'quantity', '1.0001'),
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(fleetHandler.pushFuel).not.toHaveBeenCalled();
    expect(fleetHandler.pushTrip).not.toHaveBeenCalled();
  });
});

import { ThrottlerStorageService } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { FailoverThrottlerStorage } from './failover-throttler.storage';

/** Minimalni `MULTI` sa odgovorima koje storage čita (INCR, PEXPIRE, PTTL). */
function fakeRedis(replies: [number, number, number]): Redis {
  const exec = jest.fn().mockResolvedValue([
    [null, replies[0]],
    [null, replies[1]],
    [null, replies[2]],
  ]);
  const multi = jest.fn().mockReturnValue({
    incr: jest.fn().mockReturnThis(),
    pexpire: jest.fn().mockReturnThis(),
    pttl: jest.fn().mockReturnThis(),
    exec,
  });
  return { multi } as unknown as Redis;
}

describe('FailoverThrottlerStorage (INF-07)', () => {
  // Memorijski storage postavlja `setTimeout` po ključu — gasimo ga da Jest ne visi.
  const memories: ThrottlerStorageService[] = [];
  function memory(): ThrottlerStorageService {
    const storage = new ThrottlerStorageService();
    memories.push(storage);
    return storage;
  }

  afterEach(() => {
    memories.splice(0).forEach((storage) => storage.onApplicationShutdown());
  });

  it('bez Redisa koristi memorijski storage (fail-open)', async () => {
    const storage = new FailoverThrottlerStorage(null, 'gradix:', memory());
    const record = await storage.increment('k1', 60_000, 5, 0, 'default');
    expect(record.totalHits).toBe(1);
    expect(record.isBlocked).toBe(false);
  });

  it('broji u Redisu pod prefiksom i računa blokadu preko limita', async () => {
    const redis = fakeRedis([6, 1, 42_000]);
    const storage = new FailoverThrottlerStorage(redis, 'gradix:', memory());
    const record = await storage.increment('abc', 60_000, 5, 0, 'default');

    expect((redis.multi as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    const multi = (redis.multi as jest.Mock).mock.results[0].value as {
      incr: jest.Mock;
      pexpire: jest.Mock;
    };
    expect(multi.incr.mock.calls[0]).toEqual(['gradix:throttle:default:abc']);
    expect(multi.pexpire.mock.calls[0]).toEqual([
      'gradix:throttle:default:abc',
      60_000,
      'NX',
    ]);
    expect(record.totalHits).toBe(6);
    expect(record.timeToExpire).toBe(42);
    expect(record.isBlocked).toBe(true);
    expect(record.timeToBlockExpire).toBe(42);
  });

  it('kad Redis padne, prelazi na memorijski storage bez bacanja greške', async () => {
    const broken = {
      multi: jest.fn().mockReturnValue({
        incr: jest.fn().mockReturnThis(),
        pexpire: jest.fn().mockReturnThis(),
        pttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('connection is closed')),
      }),
    } as unknown as Redis;
    const storage = new FailoverThrottlerStorage(broken, 'gradix:', memory());
    const record = await storage.increment('k', 60_000, 5, 0, 'default');
    expect(record.totalHits).toBe(1);
    expect(record.isBlocked).toBe(false);
  });

  it('negativan PTTL (ključ bez isteka) tretira se kao puni TTL', async () => {
    const storage = new FailoverThrottlerStorage(
      fakeRedis([1, 0, -1]),
      'gradix:',
      memory(),
    );
    const record = await storage.increment('k', 60_000, 5, 0, 'default');
    expect(record.timeToExpire).toBe(60);
  });
});

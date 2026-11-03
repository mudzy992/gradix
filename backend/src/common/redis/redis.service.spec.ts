jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const RedisMock = Redis as unknown as jest.Mock;

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function clientStub(overrides: Record<string, unknown> = {}) {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
    on: jest.fn(),
    ...overrides,
  };
}

describe('RedisService (INF-07)', () => {
  beforeEach(() => RedisMock.mockReset());

  it('bez `REDIS_HOST` nije aktivan i ping vraća `disabled`', async () => {
    const service = new RedisService(config({}));
    expect(service.enabled).toBe(false);
    expect(service.client).toBeNull();
    expect(await service.ping()).toMatchObject({ status: 'disabled' });
    expect(RedisMock).not.toHaveBeenCalled();
  });

  it('sa hostom pravi ACL/TLS klijent sa `lazyConnect` i ne blokira start', () => {
    const client = clientStub();
    RedisMock.mockReturnValue(client);
    const service = new RedisService(
      config({
        REDIS_HOST: 'redis-core',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 'tajna',
        REDIS_PREFIX: 'gradix:',
        REDIS_TLS_CA_FILE: '/nonexistent/ca.crt',
      }),
    );
    expect(service.enabled).toBe(true);
    expect(RedisMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'redis-core',
        port: 6380,
        username: 'gradix',
        password: 'tajna',
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      }),
    );
    expect(client.connect).toHaveBeenCalled();
  });

  it('ping vraća `error` kad klijent baci (readiness ne pada zbog toga)', async () => {
    RedisMock.mockReturnValue(
      clientStub({
        ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      }),
    );
    const service = new RedisService(
      config({ REDIS_HOST: 'redis-core', REDIS_PASSWORD: 'x' }),
    );
    expect(await service.ping()).toMatchObject({ status: 'error' });
  });

  it('gašenje aplikacije zatvara vezu', async () => {
    const client = clientStub();
    RedisMock.mockReturnValue(client);
    const service = new RedisService(
      config({ REDIS_HOST: 'redis-core', REDIS_PASSWORD: 'x' }),
    );
    await service.onApplicationShutdown();
    expect(client.quit).toHaveBeenCalled();
  });
});

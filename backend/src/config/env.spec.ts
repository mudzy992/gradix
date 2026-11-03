import { isApiDocsEnabled, resolveCorsOrigin, validateEnv } from './env';

const BASE = {
  DATABASE_URL: 'postgresql://user:pass@postgres:5432/gradix?schema=public',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  MINIO_SKIP: 'true',
};

describe('validateEnv', () => {
  it('prihvata minimalni razvojni env i popunjava defaulte', () => {
    const env = validateEnv({ ...BASE });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe('3000');
    expect(env.MINIO_PORT).toBe('9000');
    expect(env.MINIO_USE_SSL).toBe('false');
    expect(env.ENABLE_API_DOCS).toBe('false');
    expect(env.MINIO_SKIP).toBe('true');
  });

  it('LOG_LEVEL: prihvata validan nivo, odbija nepoznat (INF-04)', () => {
    expect(validateEnv({ ...BASE, LOG_LEVEL: 'debug' }).LOG_LEVEL).toBe(
      'debug',
    );
    expect(validateEnv({ ...BASE }).LOG_LEVEL).toBeUndefined();
    expect(() => validateEnv({ ...BASE, LOG_LEVEL: 'sve' })).toThrow(
      /LOG_LEVEL/,
    );
  });

  it('REDIS_*: bez hosta je isključen, sa hostom traži lozinku (INF-07)', () => {
    const off = validateEnv({ ...BASE });
    expect(off.REDIS_HOST).toBeUndefined();
    expect(off.REDIS_PREFIX).toBe('gradix:');
    expect(off.REDIS_PORT).toBe('6380');

    const on = validateEnv({
      ...BASE,
      REDIS_HOST: 'redis-core',
      REDIS_PASSWORD: 'tajna',
    });
    expect(on.REDIS_HOST).toBe('redis-core');
    expect(on.REDIS_USER).toBe('gradix');
    expect(on.REDIS_TLS_CA_FILE).toBe('/etc/ssl/redis/redis-ca.crt');

    expect(() => validateEnv({ ...BASE, REDIS_HOST: 'redis-core' })).toThrow(
      /REDIS_PASSWORD/,
    );
    expect(() => validateEnv({ ...BASE, REDIS_PORT: '99999' })).toThrow(
      /REDIS_PORT/,
    );
  });

  it('vraća string mapu (ConfigService semantika se ne mijenja)', () => {
    const env = validateEnv({ ...BASE, PORT: '8080' });
    expect(typeof env.PORT).toBe('string');
    expect(env.PORT).toBe('8080');
  });

  it('odbija env bez DATABASE_URL i imenuje varijablu', () => {
    expect(() => validateEnv({ JWT_ACCESS_SECRET: 'a'.repeat(32) })).toThrow(
      /DATABASE_URL je obavezan/,
    );
  });

  it('odbija MySQL URL (PostgreSQL je konačan, D-001)', () => {
    expect(() =>
      validateEnv({
        ...BASE,
        DATABASE_URL: 'mysql://user:pass@db:3306/gradix',
      }),
    ).toThrow(/postgresql:\/\//);
  });

  it('odbija prekratku access tajnu', () => {
    expect(() => validateEnv({ ...BASE, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /najmanje 32 znakova/,
    );
  });

  it('JWT_REFRESH_SECRET nije dio ugovora (D-029) — ne traži se ni u produkciji', () => {
    expect(() =>
      validateEnv({
        ...BASE,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'a'.repeat(32),
      }),
    ).not.toThrow();
  });

  it('u produkciji ne traži CORS_ORIGIN (prazno = same-origin, D-018)', () => {
    expect(() =>
      validateEnv({
        ...BASE,
        NODE_ENV: 'production',
      }),
    ).not.toThrow();
  });

  it('u produkciji prolazi kad su obavezne tajne i CORS postavljeni', () => {
    const env = validateEnv({
      ...BASE,
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://gradix.ba',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.CORS_ORIGIN).toBe('https://gradix.ba');
  });

  it('u razvoju ne traži CORS', () => {
    expect(() => validateEnv({ ...BASE })).not.toThrow();
  });

  it('traži MinIO varijable ako MINIO_SKIP nije uključen', () => {
    expect(() => validateEnv({ ...BASE, MINIO_SKIP: 'false' })).toThrow(
      /MINIO_ENDPOINT je obavezan/,
    );
  });

  it('SEED_DEMO je podrazumijevano "false" (produkcijski seed = platform admin, P9)', () => {
    expect(validateEnv({ ...BASE }).SEED_DEMO).toBe('false');
  });

  it('SEED_DEMO="true" uključuje demo seed', () => {
    expect(validateEnv({ ...BASE, SEED_DEMO: 'true' }).SEED_DEMO).toBe('true');
  });

  it('ne prihvata neispravan PORT', () => {
    expect(() => validateEnv({ ...BASE, PORT: 'sedam' })).toThrow(
      /PORT mora biti cijeli broj/,
    );
    expect(() => validateEnv({ ...BASE, PORT: '70000' })).toThrow(
      /PORT mora biti cijeli broj/,
    );
  });

  it('ne prihvata neispravan MINIO_USE_SSL', () => {
    expect(() => validateEnv({ ...BASE, MINIO_USE_SSL: 'možda' })).toThrow(
      /true.*false|false.*true/,
    );
  });

  it('traži SEED_PASSWORD od najmanje 10 znakova kad je postavljen', () => {
    expect(() => validateEnv({ ...BASE, SEED_PASSWORD: 'kratko' })).toThrow(
      /SEED_PASSWORD/,
    );
    expect(() =>
      validateEnv({ ...BASE, SEED_PASSWORD: 'GradixSeed1' }),
    ).not.toThrow();
  });
});

describe('resolveCorsOrigin', () => {
  it('vraća listu kad je CORS_ORIGIN postavljen', () => {
    expect(
      resolveCorsOrigin(
        'production',
        'https://gradix.ba, https://app.gradix.ba',
      ),
    ).toEqual(['https://gradix.ba', 'https://app.gradix.ba']);
  });

  it('u razvoju bez liste dozvoljava sve', () => {
    expect(resolveCorsOrigin('development', undefined)).toBe(true);
    expect(resolveCorsOrigin(undefined, '')).toBe(true);
  });

  it('u produkciji bez liste zabranjuje strane origin-e', () => {
    expect(resolveCorsOrigin('production', undefined)).toBe(false);
    expect(resolveCorsOrigin('production', '  ')).toBe(false);
  });
});

describe('isApiDocsEnabled', () => {
  it('je uključen van produkcije', () => {
    expect(isApiDocsEnabled('development', undefined)).toBe(true);
    expect(isApiDocsEnabled(undefined, undefined)).toBe(true);
  });

  it('je isključen u produkciji bez flaga', () => {
    expect(isApiDocsEnabled('production', undefined)).toBe(false);
    expect(isApiDocsEnabled('production', 'false')).toBe(false);
  });

  it('se može eksplicitno uključiti u produkciji', () => {
    expect(isApiDocsEnabled('production', 'true')).toBe(true);
  });
});

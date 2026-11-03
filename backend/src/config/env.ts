// BE-01 — validacija okruženja pri startu.
//
// Zašto bez zod-a: backend trenutno nema tu zavisnost, a pravilo iz P6/D-006 je da svaka nova
// zavisnost ima pisano obrazloženje. Ovaj validator je ~120 linija, pokriva sve varijable koje
// backend čita i daje poruku koja imenuje varijablu — dovoljno za fail-fast. Alternativa (zod)
// ostaje otvorena kad backend dobije i validaciju DTO-a kroz schema-first pristup
// (vidi docs/DECISIONS.md D-017).
//
// Uključeno kroz `ConfigModule.forRoot({ validate })` u `app.module.ts`, pa aplikacija **ne
// starta** ako nešto nedostaje ili je očigledno pogrešno (umjesto 500 na prvom zahtjevu).

export type NodeEnv = 'development' | 'test' | 'production';

type RawEnv = Record<string, string | undefined>;

export type ValidatedEnv = Record<string, string>;

export interface AppEnv {
  NODE_ENV: NodeEnv;
  PORT: number;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  CORS_ORIGIN?: string;
  MINIO_ENDPOINT?: string;
  MINIO_PORT: number;
  MINIO_USE_SSL: boolean;
  MINIO_ACCESS_KEY?: string;
  MINIO_SECRET_KEY?: string;
  MINIO_BUCKET?: string;
  MINIO_SKIP: boolean;
  SEED_PASSWORD?: string;
  SEED_DEMO: string;
  ENABLE_API_DOCS: boolean;
  LOG_LEVEL?: 'error' | 'warn' | 'info' | 'debug';
}

const MIN_SECRET_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 10;

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function asInt(
  name: string,
  value: string | undefined,
  fallback: number,
  errors: string[],
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    errors.push(`${name} mora biti cijeli broj 1–65535 (nađeno "${value}")`);
    return fallback;
  }
  return parsed;
}

function asBool(
  name: string,
  value: string | undefined,
  fallback: boolean,
  errors: string[],
): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (['true', '1', 'yes'].includes(value.toLowerCase())) return true;
  if (['false', '0', 'no'].includes(value.toLowerCase())) return false;
  errors.push(`${name} mora biti "true" ili "false" (nađeno "${value}")`);
  return fallback;
}

/**
 * Validira i normalizuje env. Baca **jednu** grešku sa svim problemima odjednom
 * (da deploy ne otkriva probleme jedan po jedan).
 *
 * Vraća **string mapu** — to je ono što `ConfigService` očekuje, a postojeći kod
 * poredi vrijednosti kao stringove (`config.get('MINIO_USE_SSL') === 'true'`).
 */
export function validateEnv(raw: RawEnv): ValidatedEnv {
  const errors: string[] = [];

  const nodeEnvRaw = optional(raw.NODE_ENV) ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnvRaw)) {
    errors.push(
      `NODE_ENV mora biti development/test/production (nađeno "${nodeEnvRaw}")`,
    );
  }
  const nodeEnv = nodeEnvRaw as NodeEnv;

  const databaseUrl = optional(raw.DATABASE_URL);
  if (!databaseUrl) {
    errors.push('DATABASE_URL je obavezan (postgresql://...)');
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL mora počinjati sa postgresql:// ili postgres://');
  }

  const accessSecret = optional(raw.JWT_ACCESS_SECRET);
  if (!accessSecret) {
    errors.push('JWT_ACCESS_SECRET je obavezan');
  } else if (accessSecret.length < MIN_SECRET_LENGTH) {
    errors.push(
      `JWT_ACCESS_SECRET mora imati najmanje ${MIN_SECRET_LENGTH} znakova`,
    );
  }

  const corsOrigin = optional(raw.CORS_ORIGIN);

  const minioSkip = asBool('MINIO_SKIP', raw.MINIO_SKIP, false, errors);
  const minioEndpoint = optional(raw.MINIO_ENDPOINT);
  const minioAccessKey = optional(raw.MINIO_ACCESS_KEY);
  const minioSecretKey = optional(raw.MINIO_SECRET_KEY);
  const minioBucket = optional(raw.MINIO_BUCKET);
  if (!minioSkip) {
    for (const [name, value] of [
      ['MINIO_ENDPOINT', minioEndpoint],
      ['MINIO_ACCESS_KEY', minioAccessKey],
      ['MINIO_SECRET_KEY', minioSecretKey],
      ['MINIO_BUCKET', minioBucket],
    ] as const) {
      if (!value)
        errors.push(
          `${name} je obavezan (ili postavi MINIO_SKIP=true u testovima)`,
        );
    }
  }

  const seedPassword = optional(raw.SEED_PASSWORD);
  if (seedPassword && seedPassword.length < MIN_PASSWORD_LENGTH) {
    errors.push(
      `SEED_PASSWORD mora imati najmanje ${MIN_PASSWORD_LENGTH} znakova`,
    );
  }

  if (errors.length) {
    throw new Error(
      `Neispravno okruženje (${errors.length}):\n${errors.map((e) => `  - ${e}`).join('\n')}\n` +
        'Uputstvo: .env.example / docs/INFRASTRUCTURE.md §5',
    );
  }

  const out: ValidatedEnv = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value;
  }
  out.NODE_ENV = nodeEnv;
  out.PORT = String(asInt('PORT', raw.PORT, 3000, errors));
  out.DATABASE_URL = databaseUrl as string;
  out.JWT_ACCESS_SECRET = accessSecret as string;
  if (corsOrigin) out.CORS_ORIGIN = corsOrigin;
  if (minioEndpoint) out.MINIO_ENDPOINT = minioEndpoint;
  out.MINIO_PORT = String(asInt('MINIO_PORT', raw.MINIO_PORT, 9000, errors));
  out.MINIO_USE_SSL = String(
    asBool('MINIO_USE_SSL', raw.MINIO_USE_SSL, false, errors),
  );
  if (minioAccessKey) out.MINIO_ACCESS_KEY = minioAccessKey;
  if (minioSecretKey) out.MINIO_SECRET_KEY = minioSecretKey;
  if (minioBucket) out.MINIO_BUCKET = minioBucket;
  out.MINIO_SKIP = String(minioSkip);
  if (seedPassword) out.SEED_PASSWORD = seedPassword;
  // BE-08: `true` = seed puni demo firmu/korisnike (razvoj, e2e). Produkcija: prazno/false.
  out.SEED_DEMO = String(asBool('SEED_DEMO', raw.SEED_DEMO, false, errors));
  out.ENABLE_API_DOCS = String(
    asBool('ENABLE_API_DOCS', raw.ENABLE_API_DOCS, false, errors),
  );
  // INF-04: `LOG_LEVEL` je opcion; neispravna vrijednost je greška (a ne tiho `info`),
  // jer bi pogrešno ime nivoa tiho isključilo logove koje neko očekuje.
  const logLevel = optional(raw.LOG_LEVEL)?.toLowerCase();
  if (logLevel !== undefined) {
    if (!['error', 'warn', 'info', 'debug'].includes(logLevel)) {
      errors.push(
        `LOG_LEVEL mora biti error/warn/info/debug (nađeno "${raw.LOG_LEVEL}")`,
      );
    } else {
      out.LOG_LEVEL = logLevel;
    }
  }

  // `asInt`/`asBool` su već skupili greške — provjeri ih i poslije normalizacije.
  if (errors.length) {
    throw new Error(
      `Neispravno okruženje (${errors.length}):\n${errors.map((e) => `  - ${e}`).join('\n')}\n` +
        'Uputstvo: .env.example / docs/INFRASTRUCTURE.md §5',
    );
  }

  return out;
}

/**
 * CORS politika (D-018): lista se čita iz `CORS_ORIGIN`, ali prazna vrijednost **nikad** ne
 * znači „reflektuj svaki origin uz credentials“:
 *  - razvoj/test bez liste → dozvoli sve (lakši rad sa localhost portovima),
 *  - produkcija bez liste → zabrani sve strane origin-e (frontend ide kroz isti nginx).
 */
export function resolveCorsOrigin(
  nodeEnv: string | undefined,
  raw: string | undefined,
): string[] | false | true {
  const list = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length) return list;
  return nodeEnv === 'production' ? false : true;
}

/** API dokumentacija je u produkciji isključena osim ako se eksplicitno traži. */
export function isApiDocsEnabled(
  nodeEnv: string | undefined,
  flag: string | undefined,
): boolean {
  if (['true', '1', 'yes'].includes((flag ?? '').toLowerCase())) return true;
  return nodeEnv !== 'production';
}

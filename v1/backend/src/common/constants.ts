export const SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;
export const EMPLOYEE_CODE_PATTERN = /^[A-Z0-9-]{1,20}$/;
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
export const MIN_PASSWORD_LENGTH = 10;
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const ACCESS_TTL = '15m';
export const REFRESH_DAYS = 30;
/** Koliko dugo čuvamo opozvane/istekle refresh tokene prije brisanja (cron). */
export const REFRESH_RETENTION_DAYS = 7;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ARGON2_MEMORY_KIB = 19456;
export const ARGON2_TIME_COST = 2;
export const ARGON2_PARALLELISM = 1;
export const PROJECT_CODE_PATTERN = /^[A-Z0-9-]{1,20}$/;
export const GEOFENCE_RADIUS_MIN = 10;
export const GEOFENCE_RADIUS_MAX = 5000;
export const AMENDMENT_REASON_MIN = 5;
export const TIMER_CRON = '*/15 * * * *';
export const PRESENCE_MAX_MS = 30 * 60 * 1000;
export const EARTH_RADIUS_M = 6_371_000;
export const MACHINE_GPS_TTL_MS = 5_000;
export const USER_GPS_TTL_MS = 15_000;
export const DIARY_PHOTO_MAX = 20;
export const HSE_PHOTO_MAX = 5;
export const DEFAULT_TIMEZONE = 'Europe/Sarajevo';
export const SYNC_CATALOG_TTL_HOURS = 24;
/** BE-18: gornja granica čekanja na `SELECT 1` u readiness provjeri; bez ovoga
 *  zaglavljena baza drži HTTP zahtjev (i Docker healthcheck) otvoren. */
export const HEALTH_PROBE_TIMEOUT_MS = 2_000;
/** BE-17: najviše itema u jednom `POST /sync/push` (klijent šalje u serijama). */
export const SYNC_PUSH_MAX_ITEMS = 200;
/** BE-17: najviše redova po kolekciji u jednom `POST /sync/pull`. */
export const SYNC_PULL_LIMIT = 1000;
export const TIMER_STARTED_AT_FUTURE_SLACK_MS = 5 * 60 * 1000;
export const SERVICE_DUE_HOURS = 50;
export const SERVICE_CRON = '0 */6 * * *';
export const DOCS_CRON = '0 * * * *';
export const GPS_CLEANUP_CRON = '15 3 * * *';
export const GPS_RETENTION_DAYS = 90;
/** BE-15: GPS pingovi se čiste u serijama (10k po upitu), ne u jednom DELETE-u. */
export const GPS_CLEANUP_BATCH = 10_000;
export const FUEL_ANOMALY_PCT = 25;
export const DOC_WARN_WINDOWS = [30, 15, 5] as const;
export const PUBLIC_GET_LIMIT = 60;
export const PUBLIC_GET_TTL_MS = 60_000;

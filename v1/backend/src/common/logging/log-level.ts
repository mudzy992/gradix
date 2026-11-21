/** INF-04: nivoi su fiksna lista (bez `fatal`/`trace`) — Coolify filtrira po `level`. */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export const LOG_LEVELS: readonly LogLevel[] = [
  'error',
  'warn',
  'info',
  'debug',
];

/**
 * INF-04: `LOG_LEVEL` pobjeđuje kad je validan; inače: produkcija `info`, razvoj `debug`,
 * testovi samo `error` (da `npx jest` ne bude zatrpan HTTP linijama).
 */
export function resolveLogLevel(
  nodeEnv: string | undefined,
  raw: string | undefined,
): LogLevel {
  const requested = (raw ?? '').trim().toLowerCase();
  if ((LOG_LEVELS as readonly string[]).includes(requested)) {
    return requested as LogLevel;
  }
  if (nodeEnv === 'test') return 'error';
  if (nodeEnv === 'development') return 'debug';
  return 'info';
}

export function isLevelEnabled(level: LogLevel, threshold: LogLevel): boolean {
  return ORDER[level] <= ORDER[threshold];
}

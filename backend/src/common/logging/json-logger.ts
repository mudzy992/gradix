import type { LoggerService } from '@nestjs/common';
import { currentRequestId } from './request-context';
import { isLevelEnabled, resolveLogLevel, type LogLevel } from './log-level';
import { redact } from './redact';

/** INF-04: jedan log zapis = jedan JSON red (Coolify/Docker `json-file` ga parsira). */
export interface LogRecord {
  ts: string;
  level: LogLevel;
  context: string;
  msg: string;
  requestId?: string;
  [key: string]: unknown;
}

const MAX_STACK = 4_000;

function toMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

/**
 * INF-04: implementira Nest `LoggerService`, pa sav aplikativni kod (`new Logger(Context)`)
 * automatski piše JSON. Namjerno **bez** `pino`: jedna zavisnost manje, ~100 linija koda, isti
 * izlaz (vidi D-038).
 */
export class JsonLogger implements LoggerService {
  private readonly threshold: LogLevel;

  constructor(
    private readonly out: (line: string) => void = (line) =>
      process.stdout.write(line),
    threshold?: LogLevel,
  ) {
    this.threshold =
      threshold ?? resolveLogLevel(process.env.NODE_ENV, process.env.LOG_LEVEL);
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    const extra =
      stack && stack.length > 0
        ? { stack: stack.slice(0, MAX_STACK) }
        : undefined;
    this.write('error', message, context, extra);
  }

  /** Za slučajeve sa struktuiranim podacima (npr. HTTP linija, red u bazi). */
  write(
    level: LogLevel,
    message: unknown,
    context = 'App',
    meta?: Record<string, unknown>,
  ): void {
    if (!isLevelEnabled(level, this.threshold)) return;
    const record: LogRecord = {
      ts: new Date().toISOString(),
      level,
      context,
      msg: toMessage(message),
    };
    const requestId = currentRequestId();
    if (requestId) record.requestId = requestId;
    if (meta) {
      const clean = redact(meta);
      if (clean && typeof clean === 'object') {
        Object.assign(record, clean as Record<string, unknown>);
      }
    }
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({
        ts: record.ts,
        level,
        context,
        msg: record.msg,
        logError: 'unserializable meta',
      });
    }
    this.out(`${line}\n`);
  }
}

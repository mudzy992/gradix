import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { JsonLogger } from './json-logger';
import { runWithRequestContext } from './request-context';

export const REQUEST_ID_HEADER = 'x-request-id';
/** Prihvatamo samo „id-safe“ vrijednost (npr. iz nginx-a ili klijenta); sve drugo zamjenjujemo. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Probe rute (Docker/Coolify healthcheck, external monitoring) pogađaju se svakih 30 s — na
 * `info` nivou to je ~2.900 identičnih linija dnevno po kontejneru i potiskuje stvarne događaje.
 * Zato se uspješne probe loguju na `debug`; greška (5xx) ostaje `error`.
 */
const PROBE_PATHS = new Set(['/api/health', '/api/ready']);

export function resolveRequestId(header: unknown): string {
  if (typeof header === 'string' && REQUEST_ID_PATTERN.test(header)) {
    return header;
  }
  return randomUUID();
}

/**
 * INF-04: korelacioni ID + jedna HTTP linija po zahtjevu.
 *
 * Namjerno se **ne** loguju: query string (može nositi email/filtere), tijelo zahtjeva, headeri
 * (osim validnog `x-request-id`) ni IP adresa. To je pravilo „nema PII u logu“ iz plana.
 */
export function requestLogMiddleware(
  logger: JsonLogger = new JsonLogger(),
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    res.setHeader(REQUEST_ID_HEADER, requestId);
    const startedAt = process.hrtime.bigint();
    let logged = false;

    const emit = (): void => {
      if (logged) return;
      logged = true;
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const path = req.originalUrl?.split('?')[0] ?? req.url.split('?')[0];
      const level =
        res.statusCode >= 500
          ? 'error'
          : PROBE_PATHS.has(path)
            ? 'debug'
            : 'info';
      logger.write(level, 'http_request', 'HTTP', {
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      });
    };

    res.on('finish', emit);
    res.on('close', emit);
    runWithRequestContext({ requestId }, () => next());
  };
}

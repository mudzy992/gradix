import type { NextFunction, Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import {
  requestLogMiddleware,
  resolveRequestId,
} from './request-log.middleware';
import { currentRequestId } from './request-context';
import { JsonLogger } from './json-logger';

interface MockResponse extends EventEmitter {
  statusCode: number;
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  emitFinish(): void;
}

function fakeResponse(): Response & { emitFinish: () => void } {
  const res = new EventEmitter() as MockResponse;
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = function (this: MockResponse, name, value) {
    this.headers[name] = value;
  };
  res.emitFinish = () => res.emit('finish');
  return res as unknown as Response & { emitFinish: () => void };
}

describe('requestLogMiddleware (INF-04)', () => {
  it('prihvata validan `x-request-id` i vraća ga u odgovoru', () => {
    const lines: string[] = [];
    const logger = new JsonLogger((line: string) => lines.push(line), 'debug');
    const middleware = requestLogMiddleware(logger);
    const res = fakeResponse();
    let seen: string | undefined;
    middleware(
      {
        headers: { 'x-request-id': 'nginx-abc-123' },
        method: 'GET',
        originalUrl: '/api/x',
      } as unknown as Request,
      res,
      (() => {
        seen = currentRequestId();
      }) as NextFunction,
    );
    expect(seen).toBe('nginx-abc-123');
    expect(
      (res as unknown as { headers: Record<string, string> }).headers[
        'x-request-id'
      ],
    ).toBe('nginx-abc-123');
  });

  it('odbačen `x-request-id` (predugačak / nedozvoljeni znakovi) zamjenjuje se novim UUID', () => {
    expect(resolveRequestId('a'.repeat(65))).not.toBe('a'.repeat(65));
    expect(resolveRequestId('sa razmakom')).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('validan.id-123')).toBe('validan.id-123');
  });

  it('loguje jednu liniju: metoda, putanja bez query-ja, status, trajanje', () => {
    const lines: string[] = [];
    const logger = new JsonLogger((line: string) => lines.push(line), 'debug');
    const res = fakeResponse();
    res.statusCode = 201;
    requestLogMiddleware(logger)(
      {
        headers: {},
        method: 'POST',
        originalUrl: '/api/auth/login?email=radnik@example.com&token=abc',
      } as unknown as Request,
      res,
      (() => undefined) as NextFunction,
    );
    res.emitFinish();
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0].trim()) as {
      level: string;
      msg: string;
      method: string;
      path: string;
      status: number;
      durationMs: number;
    };
    expect(record.msg).toBe('http_request');
    expect(record.method).toBe('POST');
    expect(record.path).toBe('/api/auth/login');
    expect(record.status).toBe(201);
    expect(typeof record.durationMs).toBe('number');
    // Query string (email/token) ne smije doći u log.
    expect(lines[0]).not.toContain('radnik@example.com');
    expect(lines[0]).not.toContain('token');
  });

  it('5xx se loguje kao `error` nivo', () => {
    const lines: string[] = [];
    const logger = new JsonLogger((line: string) => lines.push(line), 'debug');
    const res = fakeResponse();
    res.statusCode = 500;
    requestLogMiddleware(logger)(
      {
        headers: {},
        method: 'GET',
        originalUrl: '/api/puklo',
      } as unknown as Request,
      res,
      (() => undefined) as NextFunction,
    );
    res.emitFinish();
    const record = JSON.parse(lines[0].trim()) as { level: string };
    expect(record.level).toBe('error');
  });

  it('uspješna probe ruta ide na `debug`, obična ruta ostaje `info`', () => {
    const lines: string[] = [];
    const logger = new JsonLogger((line: string) => lines.push(line), 'error');
    const debugLines: string[] = [];
    const debugLogger = new JsonLogger(
      (line: string) => debugLines.push(line),
      'debug',
    );

    const probe = fakeResponse();
    requestLogMiddleware(debugLogger)(
      {
        headers: {},
        method: 'GET',
        originalUrl: '/api/health',
      } as unknown as Request,
      probe,
      (() => undefined) as NextFunction,
    );
    probe.emitFinish();
    expect(debugLines).toHaveLength(1);
    expect(JSON.parse(debugLines[0])).toMatchObject({
      level: 'debug',
      msg: 'http_request',
      path: '/api/health',
    });

    // Na `info` nivou probe se ne pišu (zato log nije zatrpan healthcheck-om).
    const quiet = fakeResponse();
    requestLogMiddleware(logger)(
      {
        headers: {},
        method: 'GET',
        originalUrl: '/api/health',
      } as unknown as Request,
      quiet,
      (() => undefined) as NextFunction,
    );
    quiet.emitFinish();
    expect(lines).toHaveLength(0);
  });
});

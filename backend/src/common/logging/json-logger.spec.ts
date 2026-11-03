import { JsonLogger } from './json-logger';
import { runWithRequestContext } from './request-context';
import { redact, REDACTED } from './redact';
import { resolveLogLevel } from './log-level';

function capture(threshold: 'error' | 'warn' | 'info' | 'debug' = 'debug') {
  const lines: string[] = [];
  const logger = new JsonLogger((line) => lines.push(line), threshold);
  const parse = () => lines.map((line) => JSON.parse(line.trim()));
  return { logger, lines, parse };
}

describe('JsonLogger (INF-04)', () => {
  it('piše jedan JSON red po zapisu, sa nivoom i kontekstom', () => {
    const { logger, lines, parse } = capture();
    logger.warn('nešto čudno', 'TestCtx');
    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith('\n')).toBe(true);
    const [record] = parse();
    expect(record.level).toBe('warn');
    expect(record.context).toBe('TestCtx');
    expect(record.msg).toBe('nešto čudno');
    expect(typeof record.ts).toBe('string');
  });

  it('filtrira po nivou (informacije se ne pišu kad je prag `warn`)', () => {
    const { logger, lines } = capture('warn');
    logger.log('info linija');
    logger.debug('debug linija');
    logger.warn('warn linija');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('warn linija');
  });

  it('error nosi stack (skraćen) i korelacioni ID iz konteksta zahtjeva', () => {
    const { logger, parse } = capture();
    runWithRequestContext({ requestId: 'req-12345678' }, () => {
      logger.error('puklo', 'X'.repeat(10_000), 'Ctx');
    });
    const [record] = parse();
    expect(record.requestId).toBe('req-12345678');
    expect(String(record.stack).length).toBeLessThanOrEqual(4_000);
  });

  it('nikad ne piše tajne ni PII iz meta', () => {
    const { logger, parse, lines } = capture();
    logger.write('info', 'login', 'Auth', {
      email: 'radnik@example.com',
      password: 'tajna123',
      nested: { authorization: 'Bearer abc', phone: '+38761111222' },
      ok: 'vidljivo',
    });
    const [record] = parse();
    expect(record.email).toBe(REDACTED);
    expect(record.password).toBe(REDACTED);
    expect(record.nested).toEqual({
      authorization: REDACTED,
      phone: REDACTED,
    });
    expect(record.ok).toBe('vidljivo');
    expect(lines.join('')).not.toContain('radnik@example.com');
    expect(lines.join('')).not.toContain('tajna123');
  });

  it('neuspješna serijalizacija ne baca (log nikad ne ruši zahtjev)', () => {
    const { logger, parse } = capture();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      logger.write('info', 'cirkular', 'Ctx', circular),
    ).not.toThrow();
    expect(parse()[0].msg).toBe('cirkular');
  });
});

describe('redact / resolveLogLevel (INF-04)', () => {
  it('redact ne mijenja ulaz i skraćuje dugačke stringove', () => {
    const input = { token: 'abc', text: 'x'.repeat(5_000) };
    const out = redact(input) as Record<string, string>;
    expect(input.token).toBe('abc');
    expect(out.token).toBe(REDACTED);
    expect(out.text.length).toBeLessThan(2_100);
  });

  it('resolveLogLevel: eksplicitni LOG_LEVEL pobjeđuje, inače po NODE_ENV', () => {
    expect(resolveLogLevel('production', 'debug')).toBe('debug');
    expect(resolveLogLevel('production', 'nepostojeci')).toBe('info');
    expect(resolveLogLevel('development', undefined)).toBe('debug');
    expect(resolveLogLevel('test', undefined)).toBe('error');
  });
});

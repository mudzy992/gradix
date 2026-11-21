import { parseIsoDateTime } from './date-input';

describe('date-input (BE-15)', () => {
  it('prihvata datum bez vremena kao UTC ponoć', () => {
    expect(parseIsoDateTime('2026-05-02', 'expiresAt').toISOString()).toBe(
      '2026-05-02T00:00:00.000Z',
    );
  });

  it('prihvata puni ISO-8601 sa offsetom', () => {
    expect(
      parseIsoDateTime('2026-05-02T10:30:00.000Z', 'expiresAt').toISOString(),
    ).toBe('2026-05-02T10:30:00.000Z');
  });

  it('odbija nepostojeći kalendarski datum', () => {
    expect(() => parseIsoDateTime('2026-02-31', 'expiresAt')).toThrow(
      /Invalid date/,
    );
  });

  it('odbija nepostojeći datum u vremenskoj oznaci, uključujući offset', () => {
    for (const value of [
      '2026-02-31T10:30:00.000Z',
      '2026-02-29T00:30:00+02:00',
      '2026-04-31T10:30',
    ]) {
      expect(() => parseIsoDateTime(value, 'expiresAt')).toThrow(
        /Invalid date/,
      );
    }
    expect(
      parseIsoDateTime('2024-02-29T00:30:00+02:00', 'expiresAt').toISOString(),
    ).toBe('2024-02-28T22:30:00.000Z');
  });

  it('odbija tekst koji nije datum', () => {
    expect(() => parseIsoDateTime('nije-datum', 'expiresAt')).toThrow(
      /ISO date/,
    );
  });

  it('odbija prazan string i broj kao tekst', () => {
    expect(() => parseIsoDateTime('', 'expiresAt')).toThrow(/ISO date/);
    expect(() => parseIsoDateTime('20260502', 'expiresAt')).toThrow(/ISO date/);
  });
});

import { pullWatermark } from './sync-watermark';

const at = (iso: string) => ({ updatedAt: new Date(iso) });

describe('sync-watermark (BE-17)', () => {
  it('bez novih redova vraća isti `since`', () => {
    const since = new Date('2026-11-01T10:00:00.000Z');
    expect(pullWatermark(since, [[], [], []]).toISOString()).toBe(
      since.toISOString(),
    );
  });

  it('uzima najmanji zadnji `updatedAt` među kolekcijama', () => {
    const since = new Date('2026-11-01T10:00:00.000Z');
    const watermark = pullWatermark(since, [
      [at('2026-11-01T10:05:00.000Z'), at('2026-11-01T10:09:00.000Z')],
      [at('2026-11-01T10:02:00.000Z')],
      [],
    ]);
    // Najmanji „zadnji“ je 10:02 — sigurno za nastavak (nijedan red se ne preskače).
    expect(watermark.toISOString()).toBe('2026-11-01T10:02:00.000Z');
  });

  it('ignoriše prazne kolekcije (ne vraća `since` zbog njih)', () => {
    const since = new Date('2026-11-01T10:00:00.000Z');
    const watermark = pullWatermark(since, [
      [],
      [at('2026-11-01T09:59:00.000Z')],
    ]);
    expect(watermark.toISOString()).toBe('2026-11-01T09:59:00.000Z');
  });

  it('kad je kolekcija ograničena (`take`), granica je zadnji vraćeni red', () => {
    const full = Array.from({ length: 3 }, (_, index) =>
      at(`2026-11-01T10:0${index}:00.000Z`),
    );
    const watermark = pullWatermark(new Date(0), [full]);
    expect(watermark.toISOString()).toBe('2026-11-01T10:02:00.000Z');
  });
});

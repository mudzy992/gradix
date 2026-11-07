/**
 * BE-17 (F-04): `lastSyncTimestamp` je ranije bio `new Date()` u trenutku odgovora.
 * Red upisan između upita i tog trenutka ima `updatedAt` **manji** od watermark-a, pa ga
 * klijent koji pošalje `since = watermark` nikada ne dobije — tihi gubitak podatka.
 *
 * Vodena oznaka je zato najmanji „zadnji `updatedAt`“ među kolekcijama koje su nešto
 * vratile. Red na samoj granici će se poslati ponovo (klijent upsertuje po `id`), ali
 * nijedan ne može biti preskočen. Ako nijedna kolekcija nije vratila red, `since`
 * ostaje nepromijenjen.
 */
export function pullWatermark(
  since: Date,
  collections: { updatedAt: Date }[][],
): Date {
  const marks = collections
    .filter((rows) => rows.length > 0)
    .map((rows) => rows[rows.length - 1].updatedAt.getTime());
  if (marks.length === 0) {
    return since;
  }
  return new Date(Math.min(...marks));
}

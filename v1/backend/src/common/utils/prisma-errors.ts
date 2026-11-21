/**
 * BE-04 — čitanje P2002 (`unique constraint`) meta podataka na jednom mjestu.
 *
 * Prisma 7 sa driver adapterima vraća `meta.target` u različitim oblicima: niz polja,
 * ime ograničenja kao string, ili ga uopšte nema. Ranije su `users` i `companies` imale
 * dvije različite kopije ovog koda, a jedna od njih je u CI-ju promašila polje i vratila
 * `CONFLICT` umjesto `AUTH_EMAIL_TAKEN`.
 *
 * Vraća string koji sadrži imena polja/ograničenja (prazan ako se ništa ne prepozna).
 */
export function readUniqueTarget(meta: unknown): string {
  if (typeof meta !== 'object' || meta === null) {
    return '';
  }
  const parts: string[] = [];
  const target = (meta as { target?: unknown }).target;
  if (Array.isArray(target)) {
    parts.push(...target.filter((item) => typeof item === 'string'));
  } else if (typeof target === 'string') {
    parts.push(target);
  }
  // Fallback: neki adapteri popune samo ime ograničenja (npr. `User_email_key`).
  parts.push(JSON.stringify(meta));
  return parts.join(',');
}

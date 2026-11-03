/**
 * INF-04: log nikad ne smije sadržavati tajnu ni lični podatak. Umjesto da svaki pozivalac
 * pazi šta stavlja u meta, ključevi se filtriraju po imenu (i ugniježđeno, do dubine 4).
 */
const SECRET_KEYS =
  /(pass(word)?|secret|token|authorization|cookie|api[-_]?key|access[-_]?key|private[-_]?key|dsn|database[-_]?url)/i;
const PII_KEYS =
  /^(e?mail|phone|mobile|jmbg|iban|account(number)?|address|first[-_]?name|last[-_]?name|full[-_]?name|name|lat|lng|latitude|longitude)$/i;

/** Vrijednost koja zamjenjuje osjetljivo polje. */
export const REDACTED = '[redacted]';
const MAX_DEPTH = 4;
const MAX_ITEMS = 50;
const MAX_STRING = 2_000;

export function isSensitiveKey(key: string): boolean {
  return SECRET_KEYS.test(key) || PII_KEYS.test(key);
}

/** Rekurzivno čisti meta objekat; ne mijenja ulaz (vraća kopiju). */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…[truncated]`
      : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((item) => redact(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1);
  }
  return out;
}

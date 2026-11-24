/**
 * TOTP (RFC 6238) + base32 + AES-256-GCM za tajnu (spec 01 §1.5).
 *
 * Zašto bez biblioteke: algoritam je 30 linija, a `otplib` bi donio lanac zavisnosti u
 * sigurnosnu putanju. Ovdje se vidi SVE što se dešava sa tajnom, a test pokriva RFC vektore.
 *
 * Tajna se čuva šifrovana ključem izvedenim iz `AUTH_SECRET` (scrypt). Ako neko pročita
 * dump baze bez `AUTH_SECRET`, dobija šifrat, ne tajnu. Rotacija `AUTH_SECRET` obara sve
 * 2FA tajne — to je namjerno i piše u COOLIFY (moraju se ponovo upariti).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** ±1 korak: sat na telefonu i sat na serveru nisu ista stvar (§1.5.22). */
export const TOTP_WINDOW_STEPS = 1;
export const RECOVERY_CODE_COUNT = 10;

/* ------------------------------------------------------------------ base32 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Neispravna base32 tajna.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Nova tajna: 20 bajta (160 bita) — preporuka RFC 4226 za HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/* --------------------------------------------------------------------- TOTP */

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** Kod za dati vremenski korak. HMAC-SHA1 jer ga svi authenticator programi podržavaju. */
export function totpCode(secretBase32: string, step: number): string {
  const key = base32Decode(secretBase32);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export type TotpVerifyResult =
  | { ok: true; step: number }
  | { ok: false; reason: "FORMAT" | "MISMATCH" | "REPLAY" };

/**
 * Provjera koda. Poređenje je u vremenu nezavisno (`timingSafeEqual`) i pokriva prozor ±1.
 *
 * `lastUsedStep` sprječava da isti kod radi dva puta u istih 30 sekundi: bez toga bi
 * presretnut kod bio upotrebljiv do isteka koraka, a korisnik to ne bi ni primijetio.
 */
export function verifyTotp(
  code: string,
  secretBase32: string,
  options: { nowMs?: number; lastUsedStep?: number | null } = {},
): TotpVerifyResult {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, reason: "FORMAT" };
  const current = totpStep(options.nowMs ?? Date.now());
  const provided = Buffer.from(clean);
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    const expected = Buffer.from(totpCode(secretBase32, step));
    if (provided.length !== expected.length) continue;
    if (timingSafeEqual(provided, expected)) {
      if (options.lastUsedStep !== null && options.lastUsedStep !== undefined && step <= options.lastUsedStep) {
        return { ok: false, reason: "REPLAY" };
      }
      return { ok: true, step };
    }
  }
  return { ok: false, reason: "MISMATCH" };
}

/** `otpauth://` URI — ono što QR kod nosi. Nikad se ne loguje. */
export function totpUri(input: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ------------------------------------------------------------ šifrovanje */

/**
 * Ključ se izvodi iz `AUTH_SECRET` sa scrypt-om i fiksnim salt-om.
 *
 * Zašto fiksni salt nije greška: salt štiti od rainbow tabela za LJUDSKE lozinke, a ovdje
 * je ulaz već tajna od 32+ znaka. Salt po zapisu bi tražio da se čuva uz šifrat i ništa ne
 * bi dobio. Ono što se dobija jeste da ključ nije sam `AUTH_SECRET` — kompromitovanje jednog
 * ne daje drugi bez scrypt koraka.
 */
function totpKey(authSecret: string): Buffer {
  return scryptSync(authSecret, "gradix-totp-v1", 32);
}

export function encryptTotpSecret(secretPlain: string, authSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", totpKey(authSecret), iv);
  const enc = Buffer.concat([cipher.update(secretPlain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptTotpSecret(payload: string, authSecret: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !dataPart) {
    throw new Error("Nepoznat format šifrovane TOTP tajne.");
  }
  const decipher = createDecipheriv("aes-256-gcm", totpKey(authSecret), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
}

/* -------------------------------------------------------- recovery kodovi */

/** 10 kodova, čitljivih sa papira: bez 0/O i 1/I da se ne pomiješaju. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes: string[] = [];
  while (codes.length < count) {
    const bytes = randomBytes(10);
    let code = "";
    for (const byte of bytes) code += alphabet[byte % alphabet.length];
    const formatted = `${code.slice(0, 5)}-${code.slice(5, 10)}`;
    if (!codes.includes(formatted)) codes.push(formatted);
  }
  return codes;
}

/** Normalizacija unosa: korisnik može otkucati razmak ili velika slova. */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Zahtijeva 2FA za ove role (re-izvoz da potrošač ne uvozi dva modula). */
export { ROLES_REQUIRING_2FA, requires2fa } from "./password-policy";

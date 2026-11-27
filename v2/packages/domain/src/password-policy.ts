/**
 * Politika lozinki (spec 01 §1.4) — čista funkcija, bez baze i bez I/O.
 *
 * Zašto odvojeno od `apps/web/src/server/password.ts`: hash je infrastruktura (Argon2), a
 * pravila su POSLOVNA odluka. Kad se pravilo promijeni (npr. minimalna dužina), mijenja se
 * jedan fajl i test, a ne svaka ruta koja je ikad provjeravala lozinku.
 *
 * Provjere idu od najjeftinije ka najskupljoj i vraćaju PRVU grešku — korisnik ne treba
 * listu od pet stavki, treba mu jedna stvar koju da popravi.
 */
import { PASSWORD_BLACKLIST_SET } from "./password-blacklist.data";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;
/** Koliko prethodnih lozinki se pamti i zabranjuje (§1.4.18). */
export const PASSWORD_HISTORY_DEPTH = 3;
/** Poslije koliko dana uredska rola mora promijeniti lozinku (§1.4.20). */
export const PASSWORD_FORCED_RESET_DAYS = 180;
/** Koliko promašaja zaključava NALOG (ne samo IP) i na koliko minuta (§1.4.19). */
export const ACCOUNT_LOCK_ATTEMPTS = 10;
export const ACCOUNT_LOCK_MINUTES = 15;

/**
 * Role koje moraju mijenjati lozinku poslije 180 dana. Terenske su izuzete TRAJNO:
 * radnik na gradilištu bez pametnog telefona ne može ni primiti ni postaviti novu lozinku,
 * a zaključavanje bi ga ostavilo bez pristupa tačno kad mu treba.
 */
export const OFFICE_ROLES_REQUIRING_PASSWORD_ROTATION: readonly string[] = [
  "OWNER",
  "ADMIN",
  "PROJECT_MANAGER",
  "ACCOUNTANT",
];

/** Role kojima je 2FA OBAVEZNA (§1.5.21). Ostali je uključuju sami. */
export const ROLES_REQUIRING_2FA: readonly string[] = ["OWNER", "ADMIN", "ACCOUNTANT"];

export type PasswordPolicyInput = {
  password: string;
  /** Email i ime se ne smiju naći u lozinki — najčešći „moj email + 123“. */
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/**
 * Zakonita normalizacija za poređenje sa listom: lowercase, bez dijakritike i bez
 * uobičajenih zamjena (`@`→`a`, `0`→`o`, `1`→`l`, `$`→`s`).
 *
 * Zašto i zamjene: „P@ssw0rd“ je u listi kao „password“ i napadač to zna. Bez ovoga bi
 * zabrana bila dekoracija koju svi zaobiđu prvim pokušajem.
 */
export function normalizeForBlacklist(password: string): string {
  return password
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[0]/g, "o")
    .replace(/[1|]/g, "l")
    .replace(/[3]/g, "e")
    .replace(/[4]/g, "a")
    .replace(/[5]/g, "s")
    .replace(/[@]/g, "a")
    .replace(/[^a-z]/g, "");
}

/** Da li je lozinka na listi najčešćih (ili je varijanta sa zamjenama). */
export function isBlacklistedPassword(password: string): boolean {
  const exact = password.toLowerCase();
  if (PASSWORD_BLACKLIST_SET.has(exact)) return true;
  const normalized = normalizeForBlacklist(password);
  return normalized.length > 0 && PASSWORD_BLACKLIST_SET.has(normalized);
}

/**
 * Sadrži li lozinka komad identiteta korisnika (ime, prezime, email lokalni dio).
 *
 * Prag od 4 znaka: „ana“ u lozinci „banana123“ nije napad na Anu, a blokiranje bi bilo
 * smiješno. Ime od 4+ znaka unutar lozinke jeste — to je prva stvar koju neko proba.
 */
export function containsIdentity(password: string, input: PasswordPolicyInput): string | null {
  const haystack = normalizeForBlacklist(password);
  if (haystack.length === 0) return null;
  const probes: Array<{ value: string; label: string }> = [];
  const local = input.email?.split("@")[0];
  if (local) probes.push({ value: local, label: "email" });
  if (input.firstName) probes.push({ value: input.firstName, label: "ime" });
  if (input.lastName) probes.push({ value: input.lastName, label: "prezime" });
  for (const probe of probes) {
    const needle = normalizeForBlacklist(probe.value);
    if (needle.length >= 4 && haystack.includes(needle)) return probe.label;
  }
  return null;
}

/**
 * Vraća poruku za korisnika ili `null` kad lozinka prolazi. Poruke su na bosanskom i
 * govore ŠTA popraviti, ne „neispravna lozinka“.
 */
export function checkPasswordPolicy(input: PasswordPolicyInput): string | null {
  const { password } = input;
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Lozinka mora imati najmanje ${PASSWORD_MIN_LENGTH} znakova.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) return "Lozinka je predugačka.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Lozinka mora sadržavati slovo i broj.";
  }
  if (isBlacklistedPassword(password)) {
    return "Ova lozinka je na listi najčešćih lozinki. Odaberite drugu.";
  }
  const identity = containsIdentity(password, input);
  if (identity) {
    return `Lozinka ne smije sadržavati vaš ${identity}.`;
  }
  return null;
}

/**
 * Da li je nova lozinka jednaka nekoj od zadnjih `PASSWORD_HISTORY_DEPTH`.
 *
 * Poređenje hash-eva traži `verify` (Argon2) i zato je asinhrono i živi u servisu; ovdje je
 * samo odluka „koliko duboko gledamo“, da test i servis ne mogu imati različite brojeve.
 */
export function historyWindow<T>(history: readonly T[]): readonly T[] {
  return history.slice(0, PASSWORD_HISTORY_DEPTH);
}

/** Da li rola mora rotirati lozinku poslije 180 dana. */
export function requiresPasswordRotation(roles: readonly string[]): boolean {
  return roles.some((role) => OFFICE_ROLES_REQUIRING_PASSWORD_ROTATION.includes(role));
}

/**
 * Je li lozinka istekla. Vraća `false` kad role ne traže rotaciju — čak i ako je
 * `passwordExpiresAt` iz nekog razloga postavljen (npr. rola je promijenjena sa uredske na
 * terensku). Podatak o isteku ne smije nadjačati pravilo o roli.
 */
export function isPasswordExpired(
  roles: readonly string[],
  passwordExpiresAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!requiresPasswordRotation(roles)) return false;
  if (!passwordExpiresAt) return false;
  return passwordExpiresAt.getTime() <= now.getTime();
}

/** Da li je 2FA obavezna za ove role. */
export function requires2fa(roles: readonly string[]): boolean {
  return roles.some((role) => ROLES_REQUIRING_2FA.includes(role));
}

export type TwoFactorGate = "ENROLL" | "VERIFY" | "NONE";

/**
 * Šta prijava mora tražiti poslije ispravne lozinke.
 *
 * Redoslijed je namjeran: ako rola traži 2FA a korisnik je nema, traži se UPARIVANJE
 * (`ENROLL`), ne kod — nema šta da se unese. `must_enroll_2fa` pokriva slučaj kad je rola
 * promijenjena (ili je tajna resetovana) pa korisnik mora ponovo proći uparivanje.
 */
export function twoFactorGate(input: {
  roles: readonly string[];
  totpEnabled: boolean;
  mustEnroll: boolean;
}): TwoFactorGate {
  const required = requires2fa(input.roles);
  if (required && !input.totpEnabled) return "ENROLL";
  if (input.mustEnroll && !input.totpEnabled) return "ENROLL";
  if (input.totpEnabled) return "VERIFY";
  return "NONE";
}

/** Koliko traje „pre-auth“ token između lozinke i 2FA koda (spec 01 §1.5.24). */
export const PRE_AUTH_TTL_SECONDS = 5 * 60;

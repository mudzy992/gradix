/**
 * Model za brzi unos troška sa gradilišta (F5, spec 06 §1.3 + §4 „mobilno (šef)“).
 *
 * Bez React-a i bez mreže: pravila koja se mogu pogriješiti su OVDJE i testiraju se bez uređaja.
 * Ekran samo crta ono što ove funkcije vrate.
 *
 * Tri pravila koja ekran ne smije pregaziti:
 *  1. **Fotografija je dio unosa.** Bez slike nema dugmeta — na terenu bi inače nastajao iznos bez
 *     dokaza, tačno ono što spec 06 brani.
 *  2. **Iznos se ne zaokružuje u telefonu.** Unosi se tekst, provjerava se oblik (`^\d+\.\d{2}$`);
 *     pretvaranje u broj bi 120.005 tiho pretvorilo u drugi iznos.
 *  3. **Datum je poslovni dan firme.** Telefon šalje datum koji je dobio sa servera (ili ga bira
 *     čovjek); `new Date()` na uređaju u drugoj zoni ne smije odrediti dan troška.
 */

export type SiteCostForm = {
  projectId: string;
  categoryId: string;
  occurredOn: string;
  amount: string;
  note: string;
  attachmentId: string | null;
};

export const EMPTY_COST_FORM: SiteCostForm = {
  projectId: "",
  categoryId: "",
  occurredOn: "",
  amount: "",
  note: "",
  attachmentId: null,
};

/** Iznos je decimalni tekst sa TAČNO dvije decimale — isti oblik koji traži API. */
const AMOUNT_PATTERN = /^\d{1,12}\.\d{2}$/;

export function amountProblem(amount: string): string | null {
  const trimmed = amount.trim();
  if (trimmed.length === 0) return "Iznos je obavezan.";
  if (!AMOUNT_PATTERN.test(trimmed)) {
    return "Iznos upišite sa dvije decimale, npr. 120.00.";
  }
  if (/^0+\.00$/.test(trimmed)) return "Iznos mora biti veći od nule.";
  return null;
}

export function formProblem(form: SiteCostForm): string | null {
  if (!form.projectId) return "Izaberite projekat.";
  if (!form.categoryId) return "Izaberite kategoriju.";
  if (!form.occurredOn) return "Datum je obavezan.";
  const amount = amountProblem(form.amount);
  if (amount) return amount;
  if (!form.attachmentId) return "Uslikajte račun — bez fotografije trošak ne ide u knjigu.";
  return null;
}

/**
 * Tijelo za `POST /api/costs/manual`. `null` kad forma nije spremna; ekran tada ne šalje ništa
 * (a ne šalje prazan objekat da server vraća `VALIDATION_FAILED` bez objašnjenja).
 *
 * `note` se šalje samo kad nije prazan: `SafeText.max(1000)` ne prima `""` kao „nema napomene“ —
 * prazan string bi bio napomena od nula znakova, a to nije isto što i „nema napomene“.
 */
export function toManualCostPayload(form: SiteCostForm): Record<string, unknown> | null {
  if (formProblem(form) !== null) return null;
  return {
    projectId: form.projectId,
    categoryId: form.categoryId,
    occurredOn: form.occurredOn,
    amount: form.amount.trim(),
    attachmentId: form.attachmentId,
    ...(form.note.trim() ? { note: form.note.trim() } : {}),
  };
}

/** Naziv fajla za prilog: bez razmaka i bez dijakritike, da bucket ne dobije čudne ključeve. */
export function photoFileName(now: Date, index = 0): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  return `racun-${stamp}${index > 0 ? `-${index}` : ""}.jpg`;
}

/**
 * Bajtovi kao base64 (prvih N bajtova za `headBase64`).
 *
 * Ručno, a ne `btoa(String.fromCharCode(...bytes))`: `fromCharCode` sa velikim nizom prelazi
 * dozvoljeni broj argumenata i baca `RangeError` na jeftinijim telefonima.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const chunk = (b0 << 16) | (b1 << 8) | b2;
    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    output += i + 1 < bytes.length ? alphabet[(chunk >> 6) & 63] : "=";
    output += i + 2 < bytes.length ? alphabet[chunk & 63] : "=";
  }
  return output;
}

/** Prvih `count` bajtova — server po njima prepoznaje tip fajla iz SADRŽAJA. */
export function headBytes(bytes: Uint8Array, count = 32): Uint8Array {
  return bytes.slice(0, count);
}

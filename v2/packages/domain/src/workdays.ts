/**
 * Modul 3 — radno vrijeme: vrste dana, zaokruživanje segmenata, zaboravljen dan.
 *
 * Tri pravila koja se u kodu lako „poprave" na pogrešnu stranu, pa su zato ovdje, na jednom
 * mjestu i sa testovima:
 *
 *  1. **Zaokruživanje je PO SEGMENTU, ne po danu** (spec 03 §1.4.17). Tri segmenta od 7,5
 *     minuta sa zaokruživanjem na 15 daju 0 sati, a ne 22,5 → 15 minuta. Zaokruživanje po danu
 *     bi tiho poklanjalo ili otkidalo sate radniku.
 *  2. **Izostanak nije nula sati** (spec 03 §1.3.14): dan sa `day_kind = SICK` nema segmenata i
 *     ne ulazi u sate rada, ali ulazi u obračun i u saldo godišnjeg.
 *  3. **Zaboravljen dan se ne zatvara sam** (spec 03 §1.2.11): prag samo pravi pitanje, a
 *     „ne znam" daje `UNKNOWN_END` koji šef vidi kao posao. Nijedno automatsko vrijeme.
 */

/** Vrste dana (spec 03 §1.3.13). */
export const DAY_KINDS = [
  "WORK",
  "VACATION",
  "SICK",
  "PAID_LEAVE",
  "UNPAID_LEAVE",
  "HOLIDAY",
  "NO_SHOW",
] as const;

export type DayKind = (typeof DAY_KINDS)[number];

/** Dani koji troše godišnji (spec 04 §1.3.12–13: `SICK` ne troši). */
export const LEAVE_CONSUMING_DAY_KINDS: readonly DayKind[] = ["VACATION"];

/** Izostanci: dan bez segmenata, ali sa značenjem za obračun. */
export const ABSENCE_DAY_KINDS: readonly DayKind[] = [
  "VACATION",
  "SICK",
  "PAID_LEAVE",
  "UNPAID_LEAVE",
  "HOLIDAY",
];

export function isDayKind(value: unknown): value is DayKind {
  return typeof value === "string" && (DAY_KINDS as readonly string[]).includes(value);
}

/** Je li dan izostanak — tj. dan koji NE nosi sate rada. */
export function isAbsenceDay(kind: DayKind): boolean {
  return ABSENCE_DAY_KINDS.includes(kind);
}

/**
 * Troši li dan saldo godišnjeg.
 *
 * `HOLIDAY` namjerno ne troši: praznik je plaćen po drugom pravilu, a ne iz kvote radnika.
 */
export function consumesLeave(kind: DayKind): boolean {
  return LEAVE_CONSUMING_DAY_KINDS.includes(kind);
}

export const ROUNDING_MINUTES_OPTIONS = [0, 5, 10, 15, 30] as const;
export type RoundingMinutes = (typeof ROUNDING_MINUTES_OPTIONS)[number];

export const ROUNDING_MODES = ["NEAREST", "UP", "DOWN"] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

export const FORGOTTEN_DAY_HOURS_OPTIONS = [12, 16, 24] as const;

/**
 * Zaokruži JEDAN segment na izabrani korak.
 *
 * Primjeri (korak 15):
 *   NEAREST: 7 → 0, 8 → 15, 22 → 15, 23 → 30
 *   UP:      7 → 15, 15 → 15, 16 → 30
 *   DOWN:    7 → 0, 15 → 15, 16 → 15
 *
 * Negativan ulaz je greška (segment ne može trajati unazad) i odbija se umjesto da se tiho
 * zaokruži na nulu — nula bi izgledala kao legitiman rezultat.
 */
export function roundSegmentMinutes(minutes: number, step: RoundingMinutes, mode: RoundingMode): number {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`Trajanje segmenta ne može biti negativno (dobijeno: ${minutes}).`);
  }
  if (step === 0) return Math.round(minutes);

  switch (mode) {
    case "UP":
      return Math.ceil(minutes / step) * step;
    case "DOWN":
      return Math.floor(minutes / step) * step;
    case "NEAREST":
    default:
      // `Math.round` na .5 ide naviše, što je i pravilo zaokruživanja u obračunu.
      return Math.round(minutes / step) * step;
  }
}

export type RawSegment = {
  /** ISO UTC početak. */
  startedAt: string;
  /** ISO UTC kraj; `null` znači otvoren segment (ne ulazi u zbir). */
  endedAt: string | null;
};

/**
 * Zbir segmenata u minutama, sa zaokruživanjem PO SEGMENTU.
 *
 * Otvoreni segmenti (`endedAt === null`) se preskaču: njihovo trajanje još ne postoji, a
 * računanje „do sada" bi dalo broj koji se mijenja sam od sebe i koji bi ured vidio kao
 * stvarni sat.
 *
 * Negativan segment se preskače uz `invalid` brojač, a ne baca grešku: jedan pokvaren red na
 * terenu ne smije srušiti cijeli sedmični pregled, ali mora biti vidljiv.
 */
export function sumSegmentMinutes(
  segments: readonly RawSegment[],
  options: { step?: RoundingMinutes; mode?: RoundingMode } = {},
): { minutes: number; counted: number; open: number; invalid: number } {
  const step = options.step ?? 0;
  const mode = options.mode ?? "NEAREST";
  let minutes = 0;
  let counted = 0;
  let open = 0;
  let invalid = 0;

  for (const segment of segments) {
    if (segment.endedAt === null) {
      open += 1;
      continue;
    }
    const start = Date.parse(segment.startedAt);
    const end = Date.parse(segment.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      invalid += 1;
      continue;
    }
    const rawMinutes = (end - start) / 60_000;
    minutes += roundSegmentMinutes(rawMinutes, step, mode);
    counted += 1;
  }

  return { minutes, counted, open, invalid };
}

/** Trajanje segmenta u minutama, nezaokruženo — za prikaz „koliko je stvarno trajalo". */
export function segmentMinutes(segment: RawSegment): number | null {
  if (segment.endedAt === null) return null;
  const start = Date.parse(segment.startedAt);
  const end = Date.parse(segment.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return (end - start) / 60_000;
}

/**
 * Je li otvoren segment „zaboravljen" — stariji od praga firme.
 *
 * Prag je u SATIMA (12/16/24, default 16). Računa se od **početka** segmenta, a ne od zadnjeg
 * otkucaja: spec 03 §1.2.8 nudi „vrijeme zadnjeg otkucaja" kao JEDAN od izbora, ne kao mjeru
 * zaboravljenosti.
 */
export function isForgottenDay(
  segment: { startedAt: string; endedAt: string | null },
  options: { now: Date; thresholdHours: number },
): boolean {
  if (segment.endedAt !== null) return false;
  const start = Date.parse(segment.startedAt);
  if (!Number.isFinite(start)) return false;
  const ageHours = (options.now.getTime() - start) / 3_600_000;
  return ageHours > options.thresholdHours;
}

/** Način zatvaranja zaboravljenog dana (spec 03 §1.2.8–9). */
export const FORGOTTEN_CLOSE_KINDS = ["TIME", "LAST_PING", "UNKNOWN"] as const;
export type ForgottenCloseKind = (typeof FORGOTTEN_CLOSE_KINDS)[number];

/**
 * Ishod „zaboravljenog dana".
 *
 * `UNKNOWN` daje `UNKNOWN_END`, ne izmišljeno vrijeme. To je jedina razlika koja stvarno
 * postoji između „ne znam" i „vrijeme zadnjeg otkucaja": prvo je posao za šefa, drugo je
 * dokaz koji telefon ima.
 */
export function forgottenDayOutcome(input: {
  kind: ForgottenCloseKind;
  startedAt: string;
  /** Obavezan za `TIME`. */
  endedAt?: string | null;
  /** Obavezan za `LAST_PING` (vrijeme zadnjeg uspješnog slanja). */
  lastPingAt?: string | null;
}):
  | { endState: "KNOWN_END"; endedAt: string }
  | { endState: "UNKNOWN_END"; endedAt: null }
  | { error: string } {
  if (input.kind === "UNKNOWN") return { endState: "UNKNOWN_END", endedAt: null };

  const candidate = input.kind === "TIME" ? input.endedAt : input.lastPingAt;
  if (input.kind === "TIME" && !candidate) {
    return { error: "Vrijeme završetka je obavezno kad birate „unesi vrijeme“." };
  }
  if (!candidate) {
    return { error: "Telefon nema vrijeme zadnjeg otkucaja. Izaberite „ne znam“." };
  }

  const start = Date.parse(input.startedAt);
  const end = Date.parse(candidate);
  if (!Number.isFinite(end)) return { error: "Vrijeme završetka nije ispravan datum." };
  if (Number.isFinite(start) && end <= start) {
    return { error: "Kraj mora biti poslije početka segmenta." };
  }
  return { endState: "KNOWN_END", endedAt: new Date(end).toISOString() };
}

/**
 * Stanje dana za ured.
 *
 * „Za provjeru" nije `status` nego izvedeno stanje: otvoren segment koji je stariji od praga
 * ili `UNKNOWN_END`. Ured mora vidjeti i jedno i drugo u istoj listi, jer je posao isti.
 */
export type WorkdayReviewState = "OK" | "FORGOTTEN" | "UNKNOWN_END" | "OPEN_TODAY";

export function workdayReviewState(input: {
  openStartedAt: string | null;
  hasUnknownEnd: boolean;
  now: Date;
  thresholdHours: number;
}): WorkdayReviewState {
  if (input.hasUnknownEnd) return "UNKNOWN_END";
  if (!input.openStartedAt) return "OK";
  return isForgottenDay({ startedAt: input.openStartedAt, endedAt: null }, input)
    ? "FORGOTTEN"
    : "OPEN_TODAY";
}

/**
 * Zahtijeva li dan pažnju ureda — jedan izraz za listu, filter i brojač na Pregledu.
 */
export function needsOfficeReview(state: WorkdayReviewState): boolean {
  return state === "FORGOTTEN" || state === "UNKNOWN_END";
}

/** Poruka o preklapanju u ljudskom obliku (spec 03 §1.6.27) — nikad SQLSTATE. */
export function overlapMessage(input: {
  existingStart: string;
  existingEnd: string | null;
  newStart: string;
}): string {
  const format = (iso: string) =>
    new Intl.DateTimeFormat("bs-BA", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  const kraj = input.existingEnd ? format(input.existingEnd) : "još traje";
  return `Imaš zapis ${format(input.existingStart)}–${kraj}; novi počinje u ${format(input.newStart)}.`;
}

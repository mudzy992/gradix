/**
 * Modul 7 (Faza 6) — klasifikacija sati za obračun.
 *
 * PRAVILO KOJE SE NE SMIJE IZGUBITI: **svaki sat ulazi u TAČNO JEDNU kategoriju.** Sat koji je
 * istovremeno noćni i prekovremeni ne smije se platiti dvaput — ne zato što je nemoguće, nego
 * zato što zbir kategorija mora biti jednak ukupnim satima, inače se obračun ne može kontrolisati
 * (i računovođa ga ne može potpisati).
 *
 * Prioritet (`PRAZNIK > NEDJELJA > NOĆNI > PREKOVREMENI > REDOVNI`) je zato JEDAN algoritam, a ne
 * pet filtera: filteri bi se vremenom razišli, a redoslijed je dio poslovnog dogovora.
 *
 * Ovaj modul ne zna ni jednu zakonsku stopu. On daje SATE po kategorijama; množioci dolaze iz
 * `payroll_parameters` (sa datumom važenja), a neizostavljanje parametra je `PARAMETER_MISSING`,
 * nikad nula.
 */

export const PAYROLL_CATEGORIES = [
  "HOLIDAY",
  "SUNDAY",
  "NIGHT",
  "OVERTIME",
  "REGULAR",
] as const;
export type PayrollCategory = (typeof PAYROLL_CATEGORIES)[number];

/** Redoslijed je prioritet — prvi koji „uzme“ sat pobjeđuje. */
export const CATEGORY_PRIORITY: readonly PayrollCategory[] = PAYROLL_CATEGORIES;

export type OvertimeBasis = "DAILY" | "WEEKLY";

export type PayrollRules = {
  /** `null` kad firma nije definisala noćni prozor; tada nema noćnih sati (nema izmišljenog prozora). */
  nightFrom: string | null;
  nightTo: string | null;
  overtimeBasis: OvertimeBasis;
  /** Dnevni prag; koristi se samo uz `DAILY` osnov. */
  overtimeDailyThreshold: number;
  /** Sedmični prag; koristi se samo uz `WEEKLY` osnov i tada MORA postojati. */
  overtimeWeeklyThreshold: number | null;
  /** ISO dan početka sedmice: 1 = ponedjeljak … 7 = nedjelja. */
  weekStartIso: number;
};

/** Jedan komad rada u toku dana: `[startMinutes, endMinutes)` od 00:00 toga dana. */
export type MinuteSlice = { from: number; to: number };

export type DayClassificationInput = {
  /** Apsolutni minuti od početka dana, po lokalnom vremenu firme. */
  slices: readonly MinuteSlice[];
  /** Isti skup kao `workdays_day_kind_check` u bazi — nema „ostalo“ koje bi tiho značilo rad. */
  dayKind:
    | "WORK"
    | "VACATION"
    | "SICK"
    | "PAID_LEAVE"
    | "UNPAID_LEAVE"
    | "HOLIDAY"
    | "NO_SHOW";
  /** `company_holidays.is_paid` za taj datum. */
  isPaidHoliday: boolean;
  /** `true` kad je datum nedjelja po `companies.week_start` (nedjelja je uvijek zadnji dan sedmice,
   *  bez obzira na to počinje li sedmica ponedjeljkom ili nedjeljom). */
  isSunday: boolean;
  /**
   * Sati koje je radnik već odradio u ISTOJ sedmici prije ovog dana (samo uz `WEEKLY` osnov).
   * `0` za `DAILY`.
   */
  priorWeekMinutes?: number;
};

export type CategoryHours = Record<PayrollCategory, number>;

export const ZERO_HOURS: Readonly<CategoryHours> = {
  HOLIDAY: 0,
  SUNDAY: 0,
  NIGHT: 0,
  OVERTIME: 0,
  REGULAR: 0,
};

/**
 * Pretvara `HH:MM`/`HH:MM:SS` u minute od ponoći. Vraća `null` za neispravan unos — pozivalac tada
 * mora tretirati prozor kao nedefinisan, a ne kao „od 00:00“.
 */
export function parseClock(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Noćni prozor kao intervali unutar dana `[0, 1440]`.
 *
 * Prolaz preko ponoći (`22:00–06:00`) daje DVA intervala: `[1320, 1440)` i `[0, 360)`. Bez ovog
 * cijepanja bi segment od 22:00 do 02:00 izgubio dva sata ili bi ih pripisao cijelom danu.
 */
export function nightWindows(rules: Pick<PayrollRules, "nightFrom" | "nightTo">): MinuteSlice[] {
  const from = parseClock(rules.nightFrom);
  const to = parseClock(rules.nightTo);
  if (from === null || to === null) return [];
  if (from === to) return []; // prozor od nula minuta nije prozor
  if (from < to) return [{ from, to }];
  return [
    { from, to: 1440 },
    { from: 0, to },
  ];
}

function overlap(a: MinuteSlice, b: MinuteSlice): number {
  return Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));
}

/**
 * Klase po MINUTI, pa tek onda saberemo sate.
 *
 * Zašto po minuti, a ne po segmentu: segment 07:00–17:00 sa dnevnim pragom od 8 h mora dati 8
 * redovnih i 2 prekovremena, i to bez obzira na to kako je segment zapisan. Ako bi se odlučivalo
 * „po segmentu“, dva segmenta od po 4 h nikad ne bi dala prekovremeni sat — a radnik je odradio 8 h.
 */
export function classifyDay(
  input: DayClassificationInput,
  rules: PayrollRules,
): CategoryHours {
  // Izostanak nije rad: sati se ne izvode iz segmenata, nego iz vrste dana (§1.2/10).
  if (input.dayKind !== "WORK") return { ...ZERO_HOURS };

  const totalMinutes = input.slices.reduce(
    (sum, slice) => sum + Math.max(0, slice.to - slice.from),
    0,
  );
  if (totalMinutes === 0) return { ...ZERO_HOURS };

  const windows = nightWindows(rules);
  const nightMinutes = input.slices.reduce((sum, slice) => {
    // Sabiranje po prozorima može dvaput prebrojati preklapanje prozora; prozori su razdvojeni po
    // konstrukciji (`nightWindows`), pa je zbir unije jednak zbiru pojedinačnih presjeka.
    return sum + windows.reduce((inner, window) => inner + overlap(slice, window), 0);
  }, 0);

  /*
   * Prekovremeni prag se mjeri u MINUTAMA rada, ne u „satima po kategoriji“: praznik i nedjelja
   * troše prag isto kao redovni sat, jer prag govori koliko se radilo, a ne kako se plaća.
   */
  const thresholdMinutes =
    rules.overtimeBasis === "WEEKLY"
      ? Math.round((rules.overtimeWeeklyThreshold ?? 0) * 60)
      : Math.round(rules.overtimeDailyThreshold * 60);
  const prior = Math.max(0, input.priorWeekMinutes ?? 0);
  const overtimeMinutes =
    thresholdMinutes > 0
      ? Math.max(0, Math.min(totalMinutes, prior + totalMinutes - thresholdMinutes) - Math.max(0, prior - thresholdMinutes))
      : 0;

  /*
   * Raspodjela po prioritetu. Redoslijed je bitan i namjeran:
   *   1. praznik uzima sve sate dana koji je plaćeni praznik,
   *   2. nedjelja uzima sve preostale sate,
   *   3. noćni uzima noćne sate koji su ostali,
   *   4. prekovremeni uzima preostale sate preko praga,
   *   5. redovni je ostatak.
   * Time zbir uvijek izlazi tačno `totalMinutes` — nikad manje, nikad više.
   */
  if (input.isPaidHoliday) {
    return { ...ZERO_HOURS, HOLIDAY: totalMinutes / 60 };
  }
  if (input.isSunday) {
    return { ...ZERO_HOURS, SUNDAY: totalMinutes / 60 };
  }

  const night = Math.min(nightMinutes, totalMinutes);
  const remainingAfterNight = totalMinutes - night;
  const overtime = Math.min(overtimeMinutes, remainingAfterNight);
  const regular = remainingAfterNight - overtime;

  return {
    ...ZERO_HOURS,
    NIGHT: night / 60,
    OVERTIME: overtime / 60,
    REGULAR: regular / 60,
  };
}

/** Sabira klasifikacije više dana. Zbir po kategorijama = zbir ukupnih sati, uvijek. */
export function sumCategoryHours(parts: readonly CategoryHours[]): CategoryHours {
  return parts.reduce<CategoryHours>(
    (total, part) => ({
      HOLIDAY: total.HOLIDAY + part.HOLIDAY,
      SUNDAY: total.SUNDAY + part.SUNDAY,
      NIGHT: total.NIGHT + part.NIGHT,
      OVERTIME: total.OVERTIME + part.OVERTIME,
      REGULAR: total.REGULAR + part.REGULAR,
    }),
    { ...ZERO_HOURS },
  );
}

export function totalHours(hours: CategoryHours): number {
  return (
    hours.HOLIDAY + hours.SUNDAY + hours.NIGHT + hours.OVERTIME + hours.REGULAR
  );
}

/** Nedjelja je zadnji dan sedmice bez obzira na `week_start`; `getUTCDay()` daje 0 za nedjelju. */
export function isSundayDate(isoDate: string): boolean {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return false;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

export const WEEK_START_ISO: Record<string, number> = {
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
  SUN: 7,
};

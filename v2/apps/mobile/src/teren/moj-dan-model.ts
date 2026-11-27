/**
 * Model ekrana „Moj dan“ — sve odluke bez Reacta, pa se testiraju bez uređaja.
 *
 * Razdvojeno namjerno: „koje je dugme glavno“ i „da li radnik mora prvo da odgovori na stari
 * dan“ su pravila, a ne izgled. Kada su u komponenti, test ekrana ih provjerava posredno i
 * pokriju se samo slučajevi koje je neko sjetio da klikne.
 *
 * Tipovi su opis lokalnog oblika `GET /api/me/day`; ugovor je u `@gradix/contracts`, a ovdje se
 * čita samo ono što ekran koristi.
 */

export type SegmentView = {
  id: string;
  kind: "WORK" | "BREAK";
  startedAt: string;
  endedAt: string | null;
  endState: "OPEN" | "KNOWN_END" | "UNKNOWN_END";
  projectId: string | null;
  projectName: string | null;
  machineName: string | null;
};

export type DayView = {
  id: string;
  workDate: string;
  dayKind: string;
  assignmentWarning: boolean;
  segments: SegmentView[];
  minutes: number;
  openSegments: number;
  reviewState: "OK" | "FORGOTTEN" | "UNKNOWN_END" | "OPEN_TODAY";
};

export type MyDayView = {
  today: DayView | null;
  forgotten: DayView | null;
  assignments: { projectId: string; projectName: string; machineId: string | null; machineName: string | null }[];
  forgottenThresholdHours: number;
  roundingMinutes: number;
  roundingMode: "NEAREST" | "UP" | "DOWN";
};

export type MainActionKind = "start" | "pause" | "resume" | "finish";

export type MainAction = { next: MainActionKind; label: string; title: string };

/**
 * Glavna akcija iz stanja dana.
 *
 * Jedno dugme, a ne četiri: radnik ne bira između „start“ i „resume“, jer to zavisi od toga šta
 * je bilo prije — a to zna telefon, ne čovjek u rukavici.
 */
export function mainAction(day: DayView | null): MainAction {
  const openWork = day?.segments.find((segment) => segment.endState === "OPEN" && segment.kind === "WORK");
  const openBreak = day?.segments.find((segment) => segment.endState === "OPEN" && segment.kind === "BREAK");

  if (openWork) {
    // Dok rad traje, veliko dugme je pauza; kraj je druga akcija ispod.
    return { next: "pause", label: "Pauza", title: "Rad traje" };
  }
  if (openBreak) {
    return { next: "resume", label: "Nastavi rad", title: "Pauza traje" };
  }
  if (day && day.segments.length > 0 && day.openSegments === 0) {
    return { next: "start", label: "Počni novi segment", title: "Dan je završen" };
  }
  return { next: "start", label: "Počni rad", title: "Novi dan" };
}

/** Radnik mora izabrati projekat samo kad ima više od jedne dodjele. */
export function assignmentPickerNeeded(state: MyDayView | null, day: DayView | null): boolean {
  if (!state) return false;
  const unique = new Set(state.assignments.map((assignment) => assignment.projectId));
  if (unique.size <= 1) return false;
  // Ako dan već ima segment sa projektom, izbor je već napravljen za taj dan.
  return !day?.segments.some((segment) => segment.kind === "WORK" && segment.projectId);
}

/**
 * Tekst za zaboravljen dan. `null` znači „nema šta da se pita“ — ekran tada ne prikazuje
 * karticu uopšte, a ne praznu karticu sa pitanjem bez predmeta.
 */
export function forgottenPrompt(day: DayView | null): string | null {
  if (!day) return null;
  const open = day.segments.find((segment) => segment.endState === "OPEN");
  if (!open) return null;
  return `Dana ${formatDate(day.workDate)} rad je ostao otvoren od ${open.startedAt.slice(11, 16)}. Kada si prestao?`;
}

/** „traje 2 h 14 min“ — vrijeme se računa iz otvorenog segmenta, ne iz zapisanih minuta. */
export function elapsedLabel(day: DayView, now: Date, _tick = 0): string {
  const open = day.segments.find((segment) => segment.endState === "OPEN");
  if (!open) {
    const hours = Math.floor(day.minutes / 60);
    const minutes = day.minutes % 60;
    return `Završeno: ${hours} h ${minutes} min`;
  }
  const started = new Date(open.startedAt).getTime();
  const diff = Math.max(0, Math.floor((now.getTime() - started) / 60000));
  return `${open.kind === "BREAK" ? "Pauza" : "Traje"} ${Math.floor(diff / 60)} h ${diff % 60} min`;
}

/** Pomak zone u minutima, onako kako ga server očekuje (`Date.getTimezoneOffset` je obrnut). */
export function tzOffsetMinutes(at: Date): number {
  return -at.getTimezoneOffset();
}

function formatDate(iso: string): string {
  const [, month, day] = iso.slice(0, 10).split("-");
  return `${Number(day)}.${Number(month)}.${iso.slice(0, 4)}.`;
}

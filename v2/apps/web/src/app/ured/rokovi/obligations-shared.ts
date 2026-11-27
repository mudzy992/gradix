/**
 * Dijeljeni pomoćnici ekrana rokova (A2): prevodi stanja, rok u riječima i oznaka
 * nosioca obaveze. Detalj i dijalozi uvoze odatle direktno, umjesto preko klijenta
 * (ciklus klijent ↔ detalj ↔ dijalozi). Klijent re-izvozi isto.
 */
import type { Obligation, ObligationStateName } from "@gradix/contracts";

export type WorkerOption = { id: string; firstName: string; lastName: string; isActive: boolean };
export type MachineOption = { id: string; code: string; name: string; isActive: boolean };

/**
 * Nazivi stanja za ekran. Isti tekst kao `OBLIGATION_STATE_LABELS` u domeni — dva izvora bi
 * značila da web i mobilni zovu isto stanje drugačije.
 */
export const STATE_LABEL: Record<ObligationStateName, string> = {
  missing: "Nedostaje",
  expired: "Isteklo",
  rejected: "Odbijeno",
  pending_review: "Čeka provjeru",
  expiring: "Uskoro istječe",
  review_due: "Provjera dospjela",
  valid: "Važeće",
  no_expiry: "Bez roka",
  superseded: "Zamijenjeno",
};

/**
 * Da li stanje BLOKIRA rad (spec 02 §15). Ekran time odlučuje da li prikazuje „blokirano“ —
 * `missing` i `pending_review` su posao ureda, a ne razlog da radnik ne radi.
 */
export const STATE_BLOCKS = (state: ObligationStateName): boolean =>
  state === "expired" || state === "rejected";

/** Rok u riječima: „za 5 dana“, „istječe danas“, „prije 3 dana“ — bez računanja u glavi. */
export function daysLabel(obligation: Obligation): string {
  if (obligation.daysLeft === null) return "bez roka";
  if (obligation.daysLeft === 0) return "istječe danas";
  if (obligation.daysLeft === 1) return "za 1 dan";
  if (obligation.daysLeft > 1) return `za ${obligation.daysLeft} dana`;
  const ago = Math.abs(obligation.daysLeft);
  return ago === 1 ? "prije 1 dan" : `prije ${ago} dana`;
}

export const targetLabel = (obligation: Pick<Obligation,"workerName"|"machineCode"|"machineName"|"projectName"|"projectCode"|"tenderTitle">): string => {
  if (obligation.workerName) return obligation.workerName;
  if (obligation.machineCode) return `${obligation.machineCode} · ${obligation.machineName ?? ""}`.trim();
  if (obligation.projectName) {
    return obligation.projectCode
      ? `${obligation.projectCode} · ${obligation.projectName}`
      : obligation.projectName;
  }
  if (obligation.tenderTitle) return obligation.tenderTitle;
  return "Cijela firma";
};

/**
 * C.1: riječi iz adrese → interno stanje filtera. Whitelist, ne preslikavanje svih
 * vrijednosti: URL je link, ne API, pa se samo ono što Pregled (i čovjek) može
 * smisleno zatražiti prevodi. `31-90` nije stanje u bazi nego prozor dana — računa
 * ga klijent iz `daysLeft` koji je server već izračunao po poslovnom datumu firme.
 */
export const STATE_FROM_URL: Record<string, string> = {
  isteklo: "expired",
  uskoro: "expiring",
  "31-90": "31-90",
};

/** Koliko obaveza ima rok za 31–90 dana — prozor dana, ne stanje u bazi (C.1). */
export function count3190(obligations: Obligation[]): number {
  return obligations.filter((row) => row.daysLeft !== null && row.daysLeft >= 31 && row.daysLeft <= 90).length;
};

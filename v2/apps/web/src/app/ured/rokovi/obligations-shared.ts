/**
 * Dijeljeni pomoćnici ekrana rokova (A2): prevodi stanja, rok u riječima i oznaka
 * nosioca obaveze. Detalj i dijalozi uvoze odatle direktno, umjesto preko klijenta
 * (ciklus klijent ↔ detalj ↔ dijalozi). Klijent re-izvozi isto.
 */
import type { Obligation, ObligationStateName } from "@gradix/contracts";

export type WorkerOption = { id: string; firstName: string; lastName: string; isActive: boolean };
export type MachineOption = { id: string; code: string; name: string; isActive: boolean };

export const STATE_LABEL: Record<ObligationStateName, string> = {
  valid: "Važeće",
  expiring: "Uskoro istječe",
  expired: "Isteklo",
  superseded: "Zamijenjeno",
  no_expiry: "Bez roka",
};

/** Rok u riječima: „za 5 dana“, „istječe danas“, „prije 3 dana“ — bez računanja u glavi. */
export function daysLabel(obligation: Obligation): string {
  if (obligation.daysLeft === null) return "bez roka";
  if (obligation.daysLeft === 0) return "istječe danas";
  if (obligation.daysLeft === 1) return "za 1 dan";
  if (obligation.daysLeft > 1) return `za ${obligation.daysLeft} dana`;
  const ago = Math.abs(obligation.daysLeft);
  return ago === 1 ? "prije 1 dan" : `prije ${ago} dana`;
}

export const targetLabel = (obligation: Obligation): string => {
  if (obligation.workerName) return obligation.workerName;
  if (obligation.machineCode) return `${obligation.machineCode} · ${obligation.machineName ?? ""}`.trim();
  return "Cijela firma";
};

/**
 * Ishod slanja po zapisu/radniku za UI. Pravilo vlasnika: stanje "van opsega" se NE zove
 * "odbijeno" — zapis ostaje na telefonu i šef ga vidi, server ga samo nije primio u svom opsegu.
 */
export type OutcomeKind = "poslano" | "ceka" | "van-opsega" | "za-provjeru";

export function outcomeFor(status: string, lastError: string | null): { kind: OutcomeKind; label: string } {
  if (status === "sent") return { kind: "poslano", label: "Poslano" };
  if (status === "conflict") return { kind: "za-provjeru", label: "Za provjeru" };
  if (status === "rejected" && lastError === "FOREMAN_SCOPE_FORBIDDEN") {
    return { kind: "van-opsega", label: "Van opsega" };
  }
  if (status === "rejected") return { kind: "van-opsega", label: "Van opsega" };
  return { kind: "ceka", label: "Čeka slanje" };
}

/** Objašnjenje ispod bedža "Van opsega" (bedž je kratak da se ne lomi na 360 px). */
export const OUT_OF_SCOPE_NOTE =
  "Van opsega: zapis ostaje na telefonu i vidljiv je šefu; server ga nije primio jer radnik nije u opsegu za taj projekat i datum.";

/**
 * Banner NE smije tvrditi "bez veze" samo zato što nešto čeka slanje (telefon,
 * 2026-11-07: banner je vikao "Bez veze" i na mreži). "Bez veze" se kaže tek kad je
 * pokušaj slanja stvarno pao (syncFailed) — do tada samo broji koliko čeka.
 */
export function syncBannerText(input: { pending: number; syncFailed: boolean }): string {
  if (input.pending === 0) return "Sve je poslano.";
  return input.syncFailed
    ? `Bez veze · ${input.pending} čeka slanje. Sačuvano na ovom telefonu.`
    : `${input.pending} čeka slanje.`;
}

export type SendOutcomeSummary = {
  applied: number; duplicate: number; conflict: number; rejected: number; retry: number; error: string | null;
};

/**
 * Poruka poslije "Pošalji sada" mora reći šta se STVARNO desilo: push rezultat i
 * neuspjeli pull nisu "nema veze sa serverom". Kad server nije ni dosegnut (retry),
 * tek tada je poruka o vezi; kad je push prošao a potvrda (pull) pala, kaže se oboje.
 */
export function sendResultMessage(outcome: SendOutcomeSummary): string {
  const processed = outcome.applied + outcome.duplicate + outcome.conflict + outcome.rejected;
  if (processed === 0 && outcome.retry > 0) {
    return "Nema veze sa serverom. Zapisi ostaju na telefonu i poslaće se kasnije.";
  }
  const base = `Slanje završeno: poslano ${outcome.applied + outcome.duplicate}, za provjeru ${outcome.conflict}.`;
  return outcome.error
    ? `${base} Potvrda sa servera nije stigla do kraja — ishod po zapisu je ispod, a ponovno slanje je sigurno (server prepoznaje duplikate).`
    : base;
}

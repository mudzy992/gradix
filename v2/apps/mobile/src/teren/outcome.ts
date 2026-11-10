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

export function syncBannerText(input: { pending: number; offline: boolean }): string {
  if (input.pending === 0) return "Sve je poslano.";
  return input.offline
    ? `Bez veze · ${input.pending} čeka slanje. Sačuvano na ovom telefonu.`
    : `${input.pending} čeka slanje.`;
}

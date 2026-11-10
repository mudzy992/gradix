/**
 * Ishod slanja po zapisu/radniku za UI. Pravilo vlasnika: stanje "van opsega" se NE zove
 * "odbijeno" — zapis ostaje na telefonu i šef ga vidi, server ga samo nije primio u svom opsegu.
 */
export type OutcomeKind = "poslano" | "ceka" | "van-opsega" | "za-provjeru";

export function outcomeFor(status: string, lastError: string | null): { kind: OutcomeKind; label: string } {
  if (status === "sent") return { kind: "poslano", label: "Poslano" };
  if (status === "conflict") return { kind: "za-provjeru", label: "Za provjeru" };
  if (status === "rejected" && lastError === "FOREMAN_SCOPE_FORBIDDEN") {
    return { kind: "van-opsega", label: "Van opsega — ostaje na telefonu" };
  }
  if (status === "rejected") return { kind: "van-opsega", label: "Nije primljeno — ostaje na telefonu" };
  return { kind: "ceka", label: "Čeka slanje" };
}

export function syncBannerText(input: { pending: number; offline: boolean }): string {
  if (input.pending === 0) return "Sve je poslano.";
  return input.offline
    ? `Bez veze · ${input.pending} čeka slanje. Sačuvano na ovom telefonu.`
    : `${input.pending} čeka slanje.`;
}

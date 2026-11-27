/**
 * Matrica prelaza statusa tendera (Modul 8 §1.1).
 * Izvor: `v2/docs/specs/08-tenderi.md` §1.1 i `.cursor/docs/matrices/tenders/MATRIX.md`.
 *
 * Zašto `GO_NO_GO` postoji kao status, a ne kao polje: odluka o učešću je PRELAZ, ne
 * napomena. Tender koji stoji u `GO_NO_GO` je posao na kojem se čeka odgovor „idemo li“ —
 * i to mora biti vidljivo u listi, kanbanu i statistici. Da je obično polje, tender bi
 * izgledao kao priprema koja kasni.
 *
 * Zašto `WITHDRAWN` i `CANCELLED` nisu isto: `WITHDRAWN` je firma povukla ponudu POSLIJE
 * predaje (posao je bio realan, ali smo odustali), a `CANCELLED` je odustajanje PRIJE
 * predaje ili poništenje od naručioca. Dvije različite stvari — dvije različite statistike
 * uspješnosti (§1.1/4).
 */
export const TENDER_STATUSES = [
  "OPPORTUNITY",
  "GO_NO_GO",
  "PREPARATION",
  "SUBMITTED",
  "EVALUATION",
  "WON",
  "LOST",
  "WITHDRAWN",
  "CANCELLED",
] as const;
export type TenderStatus = (typeof TENDER_STATUSES)[number];

/**
 * Dozvoljeni prelasci. Terminalni statusi imaju prazan spisak — iz njih se ne izlazi.
 *
 * `PREPARATION → CANCELLED` postoji jer naručilac može poništiti tender i prije predaje;
 * `EVALUATION → WITHDRAWN` jer firma može povući ponudu dok traje ocjenjivanje. Oba su
 * stvarni događaji, ne greške u unosu — zato su u matrici, a ne u „izuzecima“.
 */
const NEXT: Record<TenderStatus, readonly TenderStatus[]> = {
  OPPORTUNITY: ["GO_NO_GO", "CANCELLED"],
  GO_NO_GO: ["PREPARATION", "CANCELLED"],
  PREPARATION: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["EVALUATION", "WON", "LOST", "WITHDRAWN"],
  EVALUATION: ["WON", "LOST", "WITHDRAWN"],
  WON: [],
  LOST: [],
  WITHDRAWN: [],
  CANCELLED: [],
};

export function isTenderStatus(value: string): value is TenderStatus {
  return (TENDER_STATUSES as readonly string[]).includes(value);
}

/** Statusi u kojima tender još „visi“ — ulaze u „vrijednost u toku“ (§1.5/21). */
export const TENDER_OPEN_STATUSES: readonly TenderStatus[] = [
  "OPPORTUNITY",
  "GO_NO_GO",
  "PREPARATION",
  "SUBMITTED",
  "EVALUATION",
];

/** Statusi koji moraju imati ishod sa razlogom (§1.5/20). */
export const TENDER_OUTCOME_STATUSES: readonly TenderStatus[] = ["WON", "LOST", "WITHDRAWN", "CANCELLED"];

export function isTenderTerminal(status: TenderStatus): boolean {
  return NEXT[status].length === 0;
}

/** Mogući sljedeći statusi — UI i API nude ISTU listu kao matrica (nema druge kopije). */
export function nextTenderStatuses(from: TenderStatus): readonly TenderStatus[] {
  return NEXT[from];
}

/** Isti status = no-op OK; inače mora biti u NEXT[from]. */
export function assertTenderTransition(from: TenderStatus, to: TenderStatus): void {
  if (from === to) return;
  if (!NEXT[from].includes(to)) {
    throw new Error(`TENDER_INVALID_STATUS:${from}->${to}`);
  }
}

export const TENDER_STATUS_LABEL_BS: Record<TenderStatus, string> = {
  OPPORTUNITY: "Prilika",
  GO_NO_GO: "Odluka o učešću",
  PREPARATION: "Priprema",
  SUBMITTED: "Predano",
  EVALUATION: "Ocjenjivanje",
  WON: "Dobijeno",
  LOST: "Izgubljeno",
  WITHDRAWN: "Povučeno",
  CANCELLED: "Otkazano",
};

/** F10: čiste formule za skladište, nabavku i podizvođače (spec 11). */

/** Količine su cijeli hiljaditi dijelovi jedinice, bez float aritmetike. */
export type WarehouseMovement =
  | { kind: "IN" | "OUT"; quantityMilli: bigint }
  | { kind: "COUNT"; quantityMilli: bigint };

/**
 * Stanje jednog artikla u jednom skladištu. COUNT je potpisana razlika, a transfer se
 * predstavlja kao OUT i IN u različitim skladištima, nikad kao treći tip kretnje.
 */
export function warehouseBalance(movements: readonly WarehouseMovement[]): bigint {
  return movements.reduce((balance, movement) => {
    if (movement.kind === "COUNT") return balance + movement.quantityMilli;
    if (movement.quantityMilli < 0n) throw new RangeError("Količina IN/OUT mora biti nenegativna");
    return balance + (movement.kind === "IN" ? movement.quantityMilli : -movement.quantityMilli);
  }, 0n);
}

/** Popis ne prepisuje stanje: upisuje se samo razlika izbrojanog i stanja u trenutku primjene. */
export function stockCountDifference(systemMilli: bigint, countedMilli: bigint): bigint {
  if (countedMilli < 0n) throw new RangeError("Izbrojana količina ne može biti negativna");
  return countedMilli - systemMilli;
}

/**
 * Prosječna nabavna vrijednost izlaza. Zbir vrijednosti ulaza je u feninzima, količine u
 * hiljaditim dijelovima. Rezultat se zaokružuje pola naviše na cijeli fening; nema cijene
 * ako nema ulazne količine. Ne radi validaciju raspoloživog stanja: to je posao transakcije.
 */
export function averageIssueCostCents(
  totalIncomingCostCents: bigint,
  totalIncomingMilli: bigint,
  issueMilli: bigint,
): bigint | null {
  if (totalIncomingCostCents < 0n || totalIncomingMilli < 0n || issueMilli < 0n) {
    throw new RangeError("Iznos i količine ne mogu biti negativni");
  }
  if (totalIncomingMilli === 0n) return null;
  const numerator = totalIncomingCostCents * issueMilli;
  return (numerator + totalIncomingMilli / 2n) / totalIncomingMilli;
}

/**
 * Razgraničenje već knjiženog dijela fakture pri izdavanju povezane robe. Koriste se
 * kumulativni zaokruženi udjeli: zbir parcijalnih korekcija je tačno fakturisani iznos,
 * ne zavisi od podjele izlaza i ne može premašiti fakturu. Pozivalac mora u istoj
 * transakciji zaključati vezu račun–prijem i sačuvati prethodno razgraničenu količinu.
 * Izvorni račun i izlaz ostaju zasebni zapisi; ova funkcija ne knjiži korekciju.
 */
export function invoiceReclassificationCents(
  invoiceLineCents: bigint,
  invoicedMilli: bigint,
  previouslyIssuedMilli: bigint,
  issuedMilli: bigint,
): bigint {
  if (invoiceLineCents < 0n || invoicedMilli <= 0n || previouslyIssuedMilli < 0n || issuedMilli < 0n ||
      previouslyIssuedMilli + issuedMilli > invoicedMilli) {
    throw new RangeError("Neispravni iznos ili količine razgraničenja računa");
  }
  const allocated = (quantity: bigint) => (invoiceLineCents * quantity + invoicedMilli / 2n) / invoicedMilli;
  return allocated(previouslyIssuedMilli + issuedMilli) - allocated(previouslyIssuedMilli);
}

/** Poređenje iznosa je dozvoljeno samo za poznat prijem u istoj valuti; manjak podataka nije podudaranje. */
export function invoiceReceiptComparison(input: {
  invoiceCents: bigint;
  invoiceCurrency: string;
  receivedCents: bigint | null;
  receiptCurrency: string | null;
}): "MATCH" | "PURCHASE_INVOICE_MISMATCH" | "NO_RECEIPT" | "CURRENCY_MISMATCH" {
  if (input.invoiceCents < 0n || (input.receivedCents !== null && input.receivedCents < 0n)) {
    throw new RangeError("Iznosi računa i prijema ne mogu biti negativni");
  }
  if (input.receivedCents === null) return "NO_RECEIPT";
  if (input.receiptCurrency === null || input.invoiceCurrency !== input.receiptCurrency) return "CURRENCY_MISMATCH";
  return input.receivedCents === input.invoiceCents ? "MATCH" : "PURCHASE_INVOICE_MISMATCH";
}

/** Spec 11: iznad praga, ne na samom pragu, traži viši nivo odobrenja. */
export function purchaseNeedsApproval(estimatedCents: bigint, thresholdCents: bigint): boolean {
  if (estimatedCents < 0n || thresholdCents < 0n) throw new RangeError("Iznos i prag ne mogu biti negativni");
  return estimatedCents > thresholdCents;
}

/** Procenti su bazni poeni (10000 = 100 %); svaki odbitak se zaokružuje u feninzima. */
export function subcontractorStatementAmounts(
  grossCents: bigint,
  retentionBasisPoints: bigint,
  warrantyBasisPoints: bigint,
): { grossCents: bigint; retentionCents: bigint; warrantyCents: bigint; netCents: bigint } {
  if (grossCents < 0n || retentionBasisPoints < 0n || warrantyBasisPoints < 0n
    || retentionBasisPoints + warrantyBasisPoints > 10000n) {
    throw new RangeError("Neispravan iznos ili procenti zadržavanja i garancije");
  }
  const retentionCents = (grossCents * retentionBasisPoints + 5000n) / 10000n;
  const warrantyCents = (grossCents * warrantyBasisPoints + 5000n) / 10000n;
  const netCents = grossCents - retentionCents - warrantyCents;
  // Dva nezavisna zaokruživanja mogu kod vrlo malih iznosa dati odbitak veći od bruto iznosa.
  if (netCents < 0n) throw new RangeError("Zaokruženi odbici premašuju bruto iznos");
  return { grossCents, retentionCents, warrantyCents, netCents };
}

/** Prekoračenje je upozorenje, uključujući ranije anekse u važeću vrijednost ugovora. */
export function subcontractorContractExceeded(
  approvedGrossCents: bigint,
  newGrossCents: bigint,
  contractValueCents: bigint,
): boolean {
  if (approvedGrossCents < 0n || newGrossCents < 0n || contractValueCents < 0n) {
    throw new RangeError("Iznosi ne mogu biti negativni");
  }
  return approvedGrossCents + newGrossCents > contractValueCents;
}

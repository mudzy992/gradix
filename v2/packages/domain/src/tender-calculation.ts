/**
 * F7 (Modul 8 §1.3) — kalkulacija ponude tendera.
 *
 * Zašto u domeni, a ne u servisu: ista matematika mora važiti u web servisu (koji upisuje
 * reviziju), u testovima zlatnih vrijednosti i u UI pregledu. Tri kopije formule = tri
 * različita iznosa u tri ekrana, a cijena ponude je jedini broj koji firma šalje napolje.
 *
 * Novac je BigInt u centima (`Money`), razlomci su `NUMERIC`-u-slobodni brojevi koji ulaze
 * kao decimalni stringovi (npr. `"12.50"` za 12,5 %). Nijedan korak ne koristi `float`:
 * postotak se pretvara u cijeli broj stotih dijelova, a zaokruživanje ide kroz `roundToCents`
 * (pola naviše, jedno mjesto).
 *
 * Lanac (§1.3/12):
 *   direct_cost  = Σ (quantity × unit_cost) po predmjeru  +  Σ (quantity × unit_cost) po resursima
 *   base         = direct_cost × (1 + markup/100 + risk/100)
 *   offered      = base × (1 − discount/100)
 *   margin_pct   = (offered − direct_cost) / offered × 100
 *
 * `margin_pct` je marža NAD PONUDOM (prodajna marža), ne nad troškom: „koliko od onoga što
 * naplatimo ostaje“ je pitanje na koje vlasnik traži odgovor, a razlika prema nabavnoj marži
 * se vidi samo ako se pomiješaju dvije definicije. Zato je jedna, i zove se marža.
 */

export type TenderMarginError = { code: "MARGIN_UNDEFINED"; message: string };

/** Količina i cijena jedne stavke predmjera ili resursa. */
export type TenderCostLine = {
  quantity: string;
  unitCostCents: bigint;
};

/**
 * Decimalni postotak u stotim dijelovima (`"12.5"` → `1250n`). Prihvata i cijeli broj.
 * Odbija znakove koji nijesu cifra ili tačka i više od dvije decimale — tiho zaokruživanje
 * korisničkog postotka mijenja cijenu ponude, pa se greška vidi odmah.
 */
export function parsePercent(value: string | number): bigint | null {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^-?\d{1,4}(?:\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -hundredths : hundredths;
}

/** Postotak natrag u decimalni string sa dvije decimale (`1250n` → `"12.50"`). */
export function formatPercent(hundredths: bigint): string {
  const negative = hundredths < 0n;
  const abs = negative ? -hundredths : hundredths;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/**
 * Količina × jedinična cijena, zaokruženo na cent.
 *
 * Količina je `NUMERIC(14,3)` — tri decimale — pa se množi kao hiljaditi dio: 12,5 m³ ×
 * 3,20 KM = 40,00 KM tačno, bez međurezultata u floatu.
 */
export function lineTotalCents(line: TenderCostLine): bigint {
  const quantity = parseQuantity(line.quantity);
  if (quantity === null) throw new Error(`TENDER_QUANTITY_INVALID:${line.quantity}`);
  return divideRounded(quantity * line.unitCostCents, 1000n);
}

/** Količina u hiljaditim dijelovima (`"12.345"` → `12345n`). */
export function parseQuantity(value: string): bigint | null {
  const text = value.trim();
  if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

/** Dijeljenje sa zaokruživanjem pola naviše (od nule), bez `Number`. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("TENDER_DIVIDE_BY_ZERO");
  const negative = numerator < 0n !== denominator < 0n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  const rounded = remainder * 2n >= absDen ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Zbir stavki predmjera (trošak materijala i rada po stavci). */
export function directCostFromBoq(lines: readonly TenderCostLine[]): bigint {
  return lines.reduce((total, line) => total + lineTotalCents(line), 0n);
}

/** Zbir resursa: `quantity × unit_cost` po istoj formuli — resurs nije paušalan iznos. */
export function directCostFromResources(lines: readonly TenderCostLine[]): bigint {
  return lines.reduce((total, line) => total + lineTotalCents(line), 0n);
}

export type TenderCalculationInput = {
  boq: readonly TenderCostLine[];
  resources: readonly TenderCostLine[];
  /** Marža u procentima, decimalni string (`"12.50"`). */
  markupPct: string;
  /** Rezerva za rizik, u procentima. Nije marža — pokriva nepredviđeno, pa ulazi u bazu. */
  riskReservePct: string;
  /** Popust na kraju, u procentima; odbija se od baze sa maržom i rezervom. */
  discountPct: string;
};

export type TenderCalculation = {
  boqCostCents: bigint;
  resourcesCostCents: bigint;
  directCostCents: bigint;
  /** Baza prije popusta: `direct × (1 + markup + risk)`. */
  baseCents: bigint;
  offeredValueCents: bigint;
  /** Marža nad ponudom, u stotim dijelovima procenta; `null` kad je ponuda nula. */
  marginPctHundredths: bigint | null;
  /** Marža u centima: `offered − direct`. */
  marginCents: bigint;
};

/**
 * Pun obračun ponude. Sve ulazi u centima; nijedan korak ne zaokružuje međurezultat osim
 * množenja procentom, gdje zaokruživanje mora postojati (cijena je cjelobrojna).
 */
export function calculateTender(input: TenderCalculationInput): TenderCalculation {
  const markup = parsePercent(input.markupPct);
  const risk = parsePercent(input.riskReservePct);
  const discount = parsePercent(input.discountPct);
  if (markup === null) throw new Error(`TENDER_PERCENT_INVALID:${input.markupPct}`);
  if (risk === null) throw new Error(`TENDER_PERCENT_INVALID:${input.riskReservePct}`);
  if (discount === null) throw new Error(`TENDER_PERCENT_INVALID:${input.discountPct}`);

  const boqCostCents = directCostFromBoq(input.boq);
  const resourcesCostCents = directCostFromResources(input.resources);
  const directCostCents = boqCostCents + resourcesCostCents;

  /*
   * `× 10000` jer su procenti u stotim dijelovima, a dijelimo sa 100 da dobijemo procente:
   * `direct × (10000 + markup + risk) / 10000`. Jedno dijeljenje, jedno zaokruživanje.
   */
  const baseCents = divideRounded(directCostCents * (10_000n + markup + risk), 10_000n);
  const offeredValueCents = divideRounded(baseCents * (10_000n - discount), 10_000n);

  const marginCents = offeredValueCents - directCostCents;
  const marginPctHundredths =
    offeredValueCents === 0n ? null : divideRounded(marginCents * 10_000n, offeredValueCents);

  return {
    boqCostCents,
    resourcesCostCents,
    directCostCents,
    baseCents,
    offeredValueCents,
    marginPctHundredths,
    marginCents,
  };
}

/**
 * Marža nad ponudom u procentima; `null` kad ponuda nema vrijednost.
 * `null` a ne `0` — nula bi tvrdila da marže nema, a ponuda od nule nema maržu jer nema ništa.
 */
export function marginPct(calculation: TenderCalculation): string | null {
  return calculation.marginPctHundredths === null
    ? null
    : formatPercent(calculation.marginPctHundredths);
}

export type ApprovalThresholds = {
  /** `companies.min_markup_pct` — ispod nje cijena traži odobrenje (§1.3/13). */
  minMarkupPct: string;
  /** Prag promjene u procentima; spec 08 §1.3/13: 5 %. */
  changeThresholdPct?: string;
};

export type PriceChangeCheck = {
  /** Promjena ponude u odnosu na prethodnu odobrenu reviziju, u procentima (decimalni string). */
  changePct: string | null;
  /** `true` kad nova vrijednost traži `tenders.price.approve` (OWNER/ADMIN). */
  needsApproval: boolean;
  /** Razlozi, imenovani — poruka u UI-u ne smije biti „nešto nije u redu“. */
  reasons: Array<"ABOVE_CHANGE_THRESHOLD" | "BELOW_MIN_MARKUP">;
};

/**
 * Da li nova cijena traži odobrenje: promjena ponude IZNAD praga (5 %) ili marža ISPOD
 * minimalne marže firme. Oba uslova su „ili“ — svaki sam traži drugi par očiju.
 *
 * Prag je po apsolutnoj vrijednosti: i veliko pojeftinjenje je odluka, ne tipfeler.
 */
export function priceChangeCheck(
  previousOfferedCents: bigint | null,
  nextOfferedCents: bigint,
  nextMarkupPct: string,
  thresholds: ApprovalThresholds,
): PriceChangeCheck {
  const threshold = thresholds.changeThresholdPct ?? "5.00";
  const thresholdHundredths = parsePercent(threshold) ?? 500n;
  const minMarkup = parsePercent(thresholds.minMarkupPct) ?? 0n;
  const markup = parsePercent(nextMarkupPct);
  if (markup === null) throw new Error(`TENDER_PERCENT_INVALID:${nextMarkupPct}`);

  const reasons: PriceChangeCheck["reasons"] = [];
  let changePct: string | null = null;

  if (previousOfferedCents !== null && previousOfferedCents !== 0n) {
    const delta = nextOfferedCents - previousOfferedCents;
    const absDelta = delta < 0n ? -delta : delta;
    const hundredths = divideRounded(absDelta * 10_000n, previousOfferedCents);
    const signed = delta < 0n ? -hundredths : hundredths;
    changePct = formatPercent(signed);
    if (hundredths > thresholdHundredths) reasons.push("ABOVE_CHANGE_THRESHOLD");
  }

  if (markup < minMarkup) reasons.push("BELOW_MIN_MARKUP");

  return { changePct, needsApproval: reasons.length > 0, reasons };
}

/**
 * Provjera kompletnosti checkliste prije predaje (§1.4/16): svaka `required` stavka mora
 * biti `ATTACHED` ili `NOT_APPLICABLE` sa razlogom. Vraća IMENA stavki koje blokiraju, da
 * poruka kaže šta nedostaje, a ne samo „nije kompletno“.
 */
export type ChecklistItemState = {
  code: string;
  label: string;
  required: boolean;
  status: "MISSING" | "ATTACHED" | "NOT_APPLICABLE";
  note?: string | null;
};

export function blockingChecklistItems(items: readonly ChecklistItemState[]): ChecklistItemState[] {
  return items.filter((item) => {
    if (!item.required) return false;
    if (item.status === "ATTACHED") return false;
    // `NOT_APPLICABLE` bez razloga ne pušta dalje: tišina nije odluka (§1.4/16).
    if (item.status === "NOT_APPLICABLE") return (item.note ?? "").trim().length < 3;
    return true;
  });
}

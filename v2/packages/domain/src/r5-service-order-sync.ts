/**
 * F8 — offline sync za radionicu (`service_order_action`).
 *
 * Mehaničar na terenu nema veze; rad i dijelovi se prvo bilježe na telefonu i šalju kad veza
 * dođe. Namjerno je JEDAN tip stavke (`service_order_action`) sa `kind` koji nosi radnju, a ne
 * pet tipova: sve radnje dijele isti ključ idempotencije (`actionId`) i isti red u `outbox`-u, pa
 * ponovno slanje ne može primijeniti istu radnju dvaput.
 *
 * Tri stvari koje payload NE nosi, i to je pravilo a ne propust:
 *  - `total_cost` / `labor_cost` — trošak računa server iz sati × satnica (spec 09 §1.2);
 *  - `started_at` / `finished_at` — trenutke dodjeljuje server, jer sat na telefonu nije dokaz;
 *  - cijenu dijela ako je nema — tada se koristi zadnja nabavna, isto kao na webu.
 */
import { isOffsetDateTime } from "./r4-sync-time";

export type ServiceOrderActionKind = "START" | "WAIT_PARTS" | "FINISH" | "PART";

export type ServiceOrderPartAction = {
  itemId: string;
  quantity: string;
  unitCostAmount: string | null;
  note: string | null;
};

export type ServiceOrderActionPayload = {
  kind: ServiceOrderActionKind;
  /** Sati rada — samo za `FINISH`; `null` znači „nula sati“ (ne „nepoznato“). */
  laborHours: string | null;
  externalCostAmount: string | null;
  warrantyUntil: string | null;
  note: string | null;
  part: ServiceOrderPartAction | null;
};

export type R4ServiceOrderActionPushItem = {
  localId: string;
  entityType: "service_order_action";
  /**
   * Ključ idempotencije radnje. Server upisuje `stock_movements.source_id` i
   * `service_order_parts.id` iz njega, pa ponovljeni push ne skida dio dvaput.
   */
  actionId: string;
  serviceOrderId: string;
  deviceSentAt: string;
  action: ServiceOrderActionPayload;
};

const KINDS: readonly ServiceOrderActionKind[] = ["START", "WAIT_PARTS", "FINISH", "PART"];

/** Sati: do dvije decimale, bez znaka i bez eksponenta — isti oblik koji prima `toHundredths`. */
const HOURS = /^\d{1,3}(?:\.\d{1,2})?$/;
/** Novac: decimalni tekst sa dvije decimale. */
const MONEY = /^\d{1,12}\.\d{2}$/;
/** Količina: do tri decimale (`numeric(14,3)`), ali NIKAD nula — izdavanje nule nije kretnja. */
const QUANTITY = /^\d{1,9}(?:\.\d{1,3})?$/;
const isPositiveQuantity = (value: string): boolean => QUANTITY.test(value) && !/^0+(?:\.0{1,3})?$/.test(value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isBoundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length >= 1 && value.length <= max;

/**
 * Provjera prije nego stavka uđe u `outbox`.
 *
 * Odvija se NA TELEFONU, prije reda: neispravna stavka u redu znači pokušaj slanja koji će
 * zauvijek padati i blokirati kursor za sve ostale stavke.
 */
export function validServiceOrderActionPayload(action: ServiceOrderActionPayload): boolean {
  if (!action || typeof action !== "object") return false;
  if (!KINDS.includes(action.kind)) return false;
  if (action.note !== null && (typeof action.note !== "string" || action.note.length > 1000)) return false;

  if (action.kind === "PART") {
    const part = action.part;
    if (!part) return false;
    if (!isBoundedText(part.itemId, 128)) return false;
    if (typeof part.quantity !== "string" || !isPositiveQuantity(part.quantity)) return false;
    if (part.unitCostAmount !== null && (typeof part.unitCostAmount !== "string" || !MONEY.test(part.unitCostAmount))) {
      return false;
    }
    if (part.note !== null && (typeof part.note !== "string" || part.note.length > 1000)) return false;
    return action.laborHours === null && action.externalCostAmount === null && action.warrantyUntil === null;
  }

  /* Radnje stanja ne nose dio; ako ga nose, payload je neispravan (a ne „ignoriši višak“). */
  if (action.part !== null) return false;
  if (action.laborHours !== null && (typeof action.laborHours !== "string" || !HOURS.test(action.laborHours))) {
    return false;
  }
  if (action.externalCostAmount !== null
    && (typeof action.externalCostAmount !== "string" || !MONEY.test(action.externalCostAmount))) {
    return false;
  }
  if (action.warrantyUntil !== null
    && (typeof action.warrantyUntil !== "string" || !DATE.test(action.warrantyUntil))) {
    return false;
  }
  if (action.kind !== "FINISH") {
    return action.laborHours === null && action.externalCostAmount === null && action.warrantyUntil === null;
  }
  return true;
}

/**
 * SLAJ putanja: radnja koja je već primijenjena ne smije se prijaviti kao greška.
 *
 * Telefon dobija rezultat po `localId`; `DUPLICATE` i `CONFLICT` sa kodom `SERVICE_ALREADY_DONE`
 * znače „ne mijenjaj ništa“ — red se označava kao poslan, jer bi ga ponovni pokušaj vratio u istu
 * grešku. Svaki drugi kod je stvarna greška i red ostaje za ljudsku provjeru.
 */
export function serviceActionOutcomeLabel(status: string, code?: string | null): {
  done: boolean;
  label: string;
} {
  if (status === "APPLIED") return { done: true, label: "Poslano" };
  if (status === "DUPLICATE") return { done: true, label: "Već poslano" };
  if (status === "CONFLICT" && code === "SERVICE_ALREADY_DONE") {
    return { done: true, label: "Nalog je već završen" };
  }
  if (status === "CONFLICT" && code === "STOCK_ALREADY_POSTED") {
    return { done: true, label: "Dio je već proknjižen" };
  }
  if (status === "REJECTED") return { done: false, label: "Server nije primio — provjeri unos" };
  return { done: false, label: "Za provjeru" };
}

/** Vrijeme slanja mora biti offset datum; bez toga stavka nema smisla u redu. */
export function validServiceOrderPushItem(item: R4ServiceOrderActionPushItem): boolean {
  if (!item || typeof item !== "object") return false;
  if (item.entityType !== "service_order_action") return false;
  if (!isBoundedText(item.actionId, 128)) return false;
  if (!isBoundedText(item.serviceOrderId, 128)) return false;
  if (!isOffsetDateTime(item.deviceSentAt)) return false;
  return validServiceOrderActionPayload(item.action);
}

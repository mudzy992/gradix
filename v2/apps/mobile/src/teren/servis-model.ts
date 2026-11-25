/**
 * F8 — model ekrana „Servisni nalozi“ za mehaničara.
 *
 * Bez React-a i bez mreže: sve što se može pogriješiti je OVDJE i testira se bez uređaja.
 *
 * Tri pravila koja ekran ne smije pregaziti:
 *  1. **Trošak se ne računa na telefonu.** Sati i dijelovi se šalju, a iznos nastaje na serveru
 *     (satnica na dan rada). Telefon ne prikazuje „ukupno“ dok nalog nije završen i vraćen.
 *  2. **Jedna glavna radnja.** Mehaničar u rukavici ne bira između „počni“ i „nastavi“ — to znaju
 *     status naloga i to da li je rad već počeo.
 *  3. **Dio se ne može izdati bez količine i artikla.** Red sa praznom količinom ne ulazi u outbox,
 *     jer bi server takvu stavku odbio i blokirao kursor za ostale.
 */
import type { ServiceOrderActionKind } from "@gradix/domain";

export type MechanicOrder = {
  id: string;
  machineCode: string;
  machineName: string;
  description: string | null;
  status: "PLANNED" | "APPROVED" | "IN_PROGRESS" | "WAITING_PARTS" | "DONE" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  assignedToMe: boolean;
  openedOn: string;
  totalCostAmount: string;
  currencyCode: string;
};

export const ORDER_STATUS_LABEL: Record<MechanicOrder["status"], string> = {
  PLANNED: "Planiran",
  APPROVED: "Odobren",
  IN_PROGRESS: "U radu",
  WAITING_PARTS: "Čeka dijelove",
  DONE: "Završen",
  CANCELLED: "Otkazan",
};

export const PRIORITY_LABEL: Record<MechanicOrder["priority"], string> = {
  LOW: "Nizak",
  MEDIUM: "Srednji",
  HIGH: "Visok",
  CRITICAL: "Kritičan",
};

const PRIORITY_RANK: Record<MechanicOrder["priority"], number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/**
 * Redoslijed radionice: prvo MOJI nalozi, pa prioritet, pa najstariji.
 *
 * „Moji prvo“ nije taština: mehaničar koji dođe na posao traži šta je njegovo. Tek ako nema
 * svojih, gleda tuđe — i tada prioritet odlučuje, a ne redoslijed unosa.
 */
export function mechanicQueue(orders: readonly MechanicOrder[]): MechanicOrder[] {
  const open = orders.filter((order) => order.status !== "DONE" && order.status !== "CANCELLED");
  return [...open].sort((a, b) => {
    if (a.assignedToMe !== b.assignedToMe) return a.assignedToMe ? -1 : 1;
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) return byPriority;
    return a.openedOn < b.openedOn ? -1 : a.openedOn > b.openedOn ? 1 : 0;
  });
}

export type MechanicAction = {
  kind: Extract<ServiceOrderActionKind, "START" | "WAIT_PARTS" | "FINISH">;
  label: string;
  hint: string;
};

/**
 * Jedna glavna radnja iz stanja naloga.
 *
 * `WAITING_PARTS` → `START` (nastavi rad): dio je stigao, pa se vraća u rad. `APPROVED` → `START`.
 * `PLANNED` nema radnju — nalog još nije odobren; dugme bi značilo da mehaničar smije raditi
 * neodobren posao.
 */
export function mechanicAction(order: MechanicOrder): MechanicAction | null {
  if (order.status === "DONE" || order.status === "CANCELLED" || order.status === "PLANNED") return null;
  if (order.status === "IN_PROGRESS") {
    return { kind: "FINISH", label: "Završi", hint: "Upisati sate rada" };
  }
  if (order.status === "WAITING_PARTS") {
    return { kind: "START", label: "Nastavi rad", hint: "Dio je stigao" };
  }
  return { kind: "START", label: "Počni rad", hint: "Bilježi se početak zastoja" };
}

/** Druga radnja — čekanje dijela; nema je dok rad ne počne i nema smisla na završenom nalogu. */
export function canWaitParts(order: MechanicOrder): boolean {
  return order.status === "IN_PROGRESS";
}

/**
 * Sati rada: prazno je dozvoljeno (nula sati), ali tekst mora biti broj do dvije decimale.
 *
 * Namjerno se NE pretvara u `Number`: „2,5“ sa zarezom je čest unos na telefonu sa našim
 * rasporedom tastature, pa se zarez prihvata i normalizuje u tačku — a sve ostalo je greška.
 */
export function normalizeLaborHours(input: string): string | null {
  const text = input.trim().replace(",", ".");
  if (text.length === 0) return "0";
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) return null;
  return text;
}

/** Količina dijela: do tri decimale, kao `numeric(14,3)`; zarez se normalizuje. */
export function normalizeQuantity(input: string): string | null {
  const text = input.trim().replace(",", ".");
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(text)) return null;
  if (/^0+(?:\.0{1,3})?$/.test(text)) return null;
  return text;
}

export type PartForm = { itemId: string; quantity: string; note: string };

export function partFormProblem(form: PartForm): string | null {
  if (!form.itemId) return "Izaberite dio iz šifarnika.";
  if (normalizeQuantity(form.quantity) === null) return "Količina mora biti broj veći od nule, do tri decimale.";
  if (form.note.length > 1000) return "Napomena je predugačka.";
  return null;
}

/** Tijelo jedne radnje za outbox — sastavlja se na jednom mjestu, pa polja ne mogu nedostajati. */
export function actionPayload(input: {
  kind: MechanicAction["kind"];
  laborHours?: string | null;
  externalCostAmount?: string | null;
  warrantyUntil?: string | null;
  note?: string | null;
}): {
  kind: MechanicAction["kind"];
  laborHours: string | null;
  externalCostAmount: string | null;
  warrantyUntil: string | null;
  note: string | null;
  part: null;
} {
  return {
    kind: input.kind,
    laborHours: input.laborHours ?? null,
    externalCostAmount: input.externalCostAmount ?? null,
    warrantyUntil: input.warrantyUntil ?? null,
    note: input.note?.trim() ? input.note.trim() : null,
    part: null,
  };
}

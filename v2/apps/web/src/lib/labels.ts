/** Bosanski nazivi sistemskih kodova. Kategorije su odvojene jer isti kod
 * (npr. OPEN ili APPROVED) ima različit kontekst. Poslovni nazivi kategorija
 * troškova koje uređuje firma dolaze iz baze, ne iz ovog rječnika. */
import type { z } from "zod";
import type { ProjectStatus, PayPeriodStatus, ServiceOrderStatus, WarehousesResponse, PurchaseRequestRow, PurchaseOrderRow, PurchaseInvoiceRow, HseIncidentKind, HseIncidentStatus, ServiceOrderEvent, PayrollLineStatus, MachineFaultRow } from "@gradix/contracts";
import { OBLIGATION_STATE_LABELS, COST_SOURCE_LABELS, COST_ENTRY_STATUS_LABELS } from "@gradix/domain";
import type { DayKind } from "@gradix/domain";
import type { Role } from "@/server/permissions";

export const ROLE_NAMES = {OWNER:"Vlasnik",ADMIN:"Administrator",PROJECT_MANAGER:"Vođa projekta",SITE_SUPERVISOR:"Šef gradilišta",WORKER:"Radnik",DRIVER:"Vozač",MACHINE_OPERATOR:"Rukovalac mašine",MECHANIC:"Mehaničar",ACCOUNTANT:"Računovođa"} satisfies Record<Role,string>;
export const PROJECT_STATUS_NAMES = {PLANNED:"U planu",ACTIVE:"Aktivan",PAUSED:"Pauziran",FINISHED:"Završen",CANCELLED:"Otkazan"} satisfies Record<ProjectStatus,string>;
export const DAY_KIND_NAMES = {WORK:"Rad",VACATION:"Godišnji",SICK:"Bolovanje",PAID_LEAVE:"Plaćeni dopust",UNPAID_LEAVE:"Neplaćeni dopust",HOLIDAY:"Praznik",NO_SHOW:"Nedolazak"} satisfies Record<DayKind,string>;
export const WAREHOUSE_KIND_NAMES = {CENTRAL:"Centralno skladište",SITE:"Gradilišno skladište",TANK:"Rezervoar"} satisfies Record<z.infer<typeof WarehousesResponse>["warehouses"][number]["kind"],string>;
export const REQUEST_STATUS_NAMES = {DRAFT:"Nacrt",SUBMITTED:"Predan",APPROVED:"Odobren",REJECTED:"Odbijen",ORDERED:"Naručeno",CLOSED:"Zatvoren",CANCELLED:"Otkazan"} satisfies Record<z.infer<typeof PurchaseRequestRow>["status"],string>;
export const ORDER_STATUS_NAMES = {DRAFT:"Nacrt",SENT:"Poslana",PARTIALLY_RECEIVED:"Djelimično primljena",RECEIVED:"Primljena",CANCELLED:"Otkazana"} satisfies Record<z.infer<typeof PurchaseOrderRow>["status"],string>;
export const INVOICE_STATUS_NAMES = {PENDING:"Čeka odobrenje",APPROVED:"Odobren",PAID:"Plaćen",DISPUTED:"Osporen"} satisfies Record<z.infer<typeof PurchaseInvoiceRow>["status"],string>;
export const SERVICE_STATUS_NAMES = {PLANNED:"Planiran",APPROVED:"Odobren",IN_PROGRESS:"U radu",WAITING_PARTS:"Čeka dijelove",DONE:"Završen",CANCELLED:"Otkazan"} satisfies Record<ServiceOrderStatus,string>;
export const FAULT_STATUS_NAMES = {OPEN:"Otvoren",WAITING_APPROVAL:"Čeka odobrenje",APPROVED:"Odobren",IN_PROGRESS:"U toku",DONE:"Završen",CANCELLED:"Otkazan"} satisfies Record<MachineFaultRow["status"],string>;
export const PAYROLL_STATUS_NAMES = {OPEN:"Otvoren",CALCULATED:"Izračunat",APPROVED:"Odobren",LOCKED:"Zaključan"} satisfies Record<PayPeriodStatus,string>;
export const PAYROLL_LINE_STATUS_NAMES = {OK:"Obračunato",RATE_MISSING:"Nedostaje cijena rada",PARAMETER_MISSING:"Nedostaje parametar"} satisfies Record<PayrollLineStatus,string>;
export const HSE_KIND_NAMES = {ACCIDENT:"Nesreća",NEAR_MISS:"Izbjegnuti incident",PROPERTY_DAMAGE:"Šteta na imovini",ENVIRONMENTAL:"Okoliš",OCCUPATIONAL_ILLNESS:"Bolest u vezi s radom"} satisfies Record<z.infer<typeof HseIncidentKind>,string>;
export const HSE_STATUS_NAMES = {REPORTED:"Prijavljen",INVESTIGATING:"U istrazi",ACTIONS_OPEN:"Otvorene mjere",CLOSED:"Zatvoren"} satisfies Record<z.infer<typeof HseIncidentStatus>,string>;
export const SERVICE_EVENT_NAMES = {OPENED:"Otvoren",APPROVED:"Odobren",STARTED:"Započet",PARTS_REQUESTED:"Zatraženi dijelovi",WAITING:"Na čekanju",FINISHED:"Završen",REOPENED:"Ponovo otvoren",CANCELLED:"Otkazan"} satisfies Record<ServiceOrderEvent["kind"],string>;
export const SUBCONTRACT_STATUS_NAMES = {DRAFT:"Nacrt",ACTIVE:"Aktivan",CLOSED:"Zatvoren",CANCELLED:"Otkazan",SUBMITTED:"Predana",APPROVED:"Odobrena",PAID:"Plaćena",REJECTED:"Odbijena"} as const;
export { OBLIGATION_STATE_LABELS, COST_SOURCE_LABELS, COST_ENTRY_STATUS_LABELS };

/** Nepoznat sistemski kod ne prikazuje se kao engleski i ne pretvara u poznato stanje. */
export function labelFor<T extends object>(dictionary:T, value:string | null | undefined):string {
  if (!value) return "—";
  return Object.hasOwn(dictionary, value) ? (dictionary as Record<string,string>)[value]! : "Nepoznato stanje";
}

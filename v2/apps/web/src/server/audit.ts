/**
 * Audit trag. Jedno mjesto gdje se piše, da nijedna ruta ne izmisli svoj oblik.
 *
 * Pravila:
 *  - piše se U ISTOJ transakciji kao izmjena (nema izmjene bez traga, nema traga bez izmjene),
 *  - `metadata` nikad ne sadrži tajne: tokeni, lozinke i hashevi se ovdje ne pojavljuju
 *    (test u `audit.test.ts` tvrdi da serijalizovan zapis ne sadrži vrijednost tokena),
 *  - `actor_email` i `ip_hash` se čuvaju odvojeno od `users`, da trag preživi brisanje korisnika.
 */
import type { PoolClient } from "pg";
import { createHash } from "node:crypto";

/**
 * Zatvoreni spiskovi za filter u UI-u. Isti izvor kao `AuditAction`, ali i kao vrijednosti u
 * bazi (`action` je TEXT) — test tvrdi da su sve radnje iz koda u spisku.
 */
export const AUDIT_ACTIONS = [
  "invitation.created",
  "invitation.accepted",
  "invitation.revoked",
  "password.reset_issued",
  "password.reset_used",
  "password.changed",
  "user.deactivated",
  "user.activated",
  "user.membership_changed",
  "session.revoked_all",
  // R2a
  "worker.created",
  "worker.updated",
  "worker.deactivated",
  "worker.activated",
  "worker.user_linked",
  "worker.user_unlinked",
  "equipment.created",
  "equipment.updated",
  "equipment.meter_updated",
  "equipment.meter_corrected",
  "equipment.category_created",
  "equipment.category_updated",
  "import.applied",
  // R2b
  "obligation.created",
  "obligation.updated",
  "obligation.renewed",
  "obligation.corrected",
  "obligation.deleted",
  "obligation.type_created",
  "obligation.type_updated",
  "obligation.attachment_added",
  "obligation.attachment_removed",
  // F2 — zahtjevi, nedostajuće obaveze, grupna obnova i potvrda dokumenta
  "obligation_requirement.created",
  "obligation_requirement.updated",
  "obligation_requirement.deleted",
  "obligation.missing_created",
  "obligation.bulk_renewed",
  "obligation.review_approved",
  "obligation.review_rejected",
  "obligation.review_at_updated",
  "obligation.imported",
  "obligation.exported",
  // R3
  "project.created",
  "project.updated",
  "project.status_changed",
  "project.worker_assigned",
  "project.machine_assigned",
  "project.assignment_removed",
  "project.assignment_ended",
  "project.assignment_voided",
  "project.assignment_overridden",
  "project.override_requested",
  // R4a-2
  "workday.conflict_resolved",
  // R7
  "tender.created",
  "tender.updated",
  "tender.converted",
  "tender.attachment.registered",
  "attachment.deleted",
  "attachment.confirmed",
  "fuel.priced",
  // Faza 1 — firma, pristup, platforma
  "company.settings_updated",
  "company.holiday_created",
  "company.holiday_updated",
  "company.holiday_deleted",
  "user.2fa_enabled",
  "user.2fa_disabled",
  "user.2fa_reset",
  "user.2fa_recovery_used",
  "session.revoked_admin",
  "session.revoked_self",
  "platform.company_created",
  "platform.company_suspended",
  "platform.company_activated",
  "platform.support_access_granted",
  "platform.support_access_revoked",
  "audit.retention_purged",
  // Trag PRISTUPA osjetljivim podacima (spec 01 §1.9.42) — `retention_class = ACCESS`.
  "payroll.viewed",
  "attachment.sensitive_viewed",
  // Faza 3 — radno vrijeme i radnici
  "workday.unknown_end",
  "workday.kind_changed",
  "workday.bulk_confirmed",
  "worker.profile_changed",
  "worker.sensitive_viewed",
  "worker.rate_opened",
  "worker.rate_closed",
  "worker.leave_changed",
  "worker.issuance_created",
  "worker.issuance_returned",
  "worker.ppe_template_changed",
  "worker.offboarded",
  "worker.bulk_changed",
  // Faza 4 — mehanizacija: trošak, gorivo, stacionaža, šabloni, najam
  "machine.cost_component_opened",
  "machine.cost_component_closed",
  "machine.cost_rate_manual_set",
  "machine.cost_rate_manual_cleared",
  "machine.cost_rate_snapshotted",
  "machine.rental_set",
  "machine.fault.created_from_check",
  "machine.check.photo_confirmed",
  "fuel.price_created",
  "fuel.tank_created",
  "fuel.tank_counted",
  "fuel.deviation_explained",
  "route_segment.created",
  "route_segment.updated",
  "check_template.created",
  "check_template.updated",
] as const;

export const AUDIT_ENTITY_TYPES = [
  "invitation",
  "user",
  "session",
  "worker",
  "workday",
  "worker_rate",
  "worker_leave",
  "worker_issuance",
  "ppe_template",
  "equipment",
  "equipment_category",
  "import",
  "obligation",
  "obligation_type",
  "obligation_attachment",
  "project",
  "project_assignment",
  "project_overrides",
  "sync_conflict",
  "tender",
  "fuel_entry",
  "company",
  "company_holiday",
  "platform_user",
  "support_session",
  "machine_cost_component",
  "machine_cost_rate",
  "fuel_price",
  "fuel_tank",
  "fuel_deviation",
  "route_segment",
  "check_template",
  "machine_daily_check",
] as const;

/** Radnje prikazane bosanski — jedan izvor za ekran i za detalj zapisa. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "invitation.created": "Pozivnica poslana",
  "invitation.accepted": "Pozivnica prihvaćena",
  "invitation.revoked": "Pozivnica opozvana",
  "password.reset_issued": "Reset lozinke izdat",
  "password.reset_used": "Lozinka postavljena preko linka",
  "password.changed": "Lozinka promijenjena",
  "user.deactivated": "Osoba deaktivirana",
  "user.activated": "Osoba aktivirana",
  "user.membership_changed": "Promijenjene role ili opseg",
  "session.revoked_all": "Sve sesije ugašene",
  "worker.created": "Radnik dodan",
  "worker.updated": "Radnik izmijenjen",
  "worker.deactivated": "Radnik deaktiviran",
  "worker.activated": "Radnik aktiviran",
  "worker.user_linked": "Radnik povezan sa nalogom",
  "worker.user_unlinked": "Veza radnika i naloga raskinuta",
  "equipment.created": "Mašina dodana",
  "equipment.updated": "Mašina izmijenjena",
  "equipment.meter_updated": "Brojilo ažurirano",
  "equipment.meter_corrected": "Brojilo ispravljeno",
  "equipment.category_created": "Kategorija mašina dodana",
  "equipment.category_updated": "Kategorija mašina izmijenjena",
  "import.applied": "Uvoz iz Excela",
  "obligation.created": "Obaveza dodana",
  "obligation.updated": "Obaveza izmijenjena",
  "obligation.renewed": "Obaveza obnovljena",
  "obligation.corrected": "Obaveza ispravljena",
  "obligation.deleted": "Obaveza obrisana",
  "obligation.type_created": "Tip obaveze dodan",
  "obligation.type_updated": "Tip obaveze izmijenjen",
  "obligation.attachment_added": "Prilog dodan",
  "obligation.attachment_removed": "Prilog uklonjen",
  "obligation_requirement.created": "Zahtjev za obavezom dodan",
  "obligation_requirement.updated": "Zahtjev za obavezom izmijenjen",
  "obligation_requirement.deleted": "Zahtjev za obavezom obrisan",
  "obligation.missing_created": "Kreirane nedostajuće obaveze",
  "obligation.bulk_renewed": "Grupna obnova obaveza",
  "obligation.review_approved": "Dokument potvrđen",
  "obligation.review_rejected": "Dokument odbijen",
  "obligation.review_at_updated": "Datum provjere izmijenjen",
  "obligation.imported": "Obaveze uvezene",
  "obligation.exported": "Obaveze izvezene",
  "project.created": "Projekat otvoren",
  "project.updated": "Projekat izmijenjen",
  "project.status_changed": "Promijenjen status projekta",
  "project.worker_assigned": "Radnik dodijeljen projektu",
  "project.machine_assigned": "Mašina dodijeljena projektu",
  "project.assignment_removed": "Dodjela skinuta",
  "project.assignment_ended": "Dodjela završena",
  "project.assignment_voided": "Pogrešna dodjela poništena",
  "project.assignment_overridden": "Iznimka od blokade odobrena",
  "project.override_requested": "Zatražena iznimka od blokade",
  "workday.conflict_resolved": "Sukob radnog dana razriješen",
  "tender.created": "Tender kreiran",
  "tender.updated": "Tender izmijenjen",
  "tender.converted": "Tender pretvoren u projekat",
  "tender.attachment.registered": "Prilog tendera registriran",
  "attachment.deleted": "Prilog obrisan",
  "attachment.confirmed": "Prilog potvrđen",
  "fuel.priced": "Cijena goriva unesena",
  "company.settings_updated": "Postavke firme izmijenjene",
  "company.holiday_created": "Praznik dodan",
  "company.holiday_updated": "Praznik izmijenjen",
  "company.holiday_deleted": "Praznik uklonjen",
  "user.2fa_enabled": "Dvofaktorska prijava uključena",
  "user.2fa_disabled": "Dvofaktorska prijava isključena",
  "user.2fa_reset": "Dvofaktorska prijava resetovana",
  "user.2fa_recovery_used": "Iskorišten recovery kod",
  "session.revoked_admin": "Sesija opozvana (administrator)",
  "session.revoked_self": "Sesija opozvana",
  "platform.company_created": "Firma kreirana (platforma)",
  "platform.company_suspended": "Firma suspendovana",
  "platform.company_activated": "Firma aktivirana",
  "platform.support_access_granted": "Platforma dobila podršku pristupa",
  "platform.support_access_revoked": "Podrška pristupa završena",
  "audit.retention_purged": "Stari audit zapisi uklonjeni po retenciji",
  "payroll.viewed": "Pregled obračuna",
  "attachment.sensitive_viewed": "Pregled osjetljivog priloga",
  "workday.unknown_end": "Dan zatvoren bez poznatog kraja",
  "workday.kind_changed": "Promijenjena vrsta dana",
  "workday.bulk_confirmed": "Grupna potvrda radnih dana",
  "worker.profile_changed": "Izmjena profila radnika",
  "worker.sensitive_viewed": "Pregled osjetljivih podataka radnika",
  "worker.rate_opened": "Nova cijena rada",
  "worker.rate_closed": "Zatvorena cijena rada",
  "worker.leave_changed": "Izmjena salda dopusta",
  "worker.issuance_created": "Izdato sredstvo radniku",
  "worker.issuance_returned": "Vraćeno sredstvo radnika",
  "worker.ppe_template_changed": "Izmjena šablona zaštitne opreme",
  "worker.offboarded": "Radnik odlazi — razdužen",
  "worker.bulk_changed": "Masovna izmjena radnika",
  "machine.cost_component_opened": "Otvorena komponenta troška mašine",
  "machine.cost_component_closed": "Zatvorena komponenta troška mašine",
  "machine.cost_rate_manual_set": "Ručna stopa troška upisana",
  "machine.cost_rate_manual_cleared": "Vraćeno na izračunatu stopu",
  "machine.cost_rate_snapshotted": "Stopa zamrznuta pri knjiženju",
  "machine.rental_set": "Najam mašine upisan",
  "machine.fault.created_from_check": "Kvar otvoren iz dnevnog pregleda",
  "machine.check.photo_confirmed": "Fotografija kritičnog nalaza potvrđena",
  "fuel.price_created": "Cijena goriva u šifarnik",
  "fuel.tank_created": "Cisterna upisana",
  "fuel.tank_counted": "Popis cisterne",
  "fuel.deviation_explained": "Odstupanje goriva objašnjeno",
  "route_segment.created": "Dionica upisana",
  "route_segment.updated": "Dionica izmijenjena",
  "check_template.created": "Šablon pregleda upisan",
  "check_template.updated": "Šablon pregleda izmijenjen",
};

/** Tip je izveden iz spiska, pa se ne mogu razići: nova radnja se dodaje na JEDNO mjesto. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Polja koja se NIKAD ne upisuju u audit — provjerava se prije upisa, ne poslije. */
const FORBIDDEN_METADATA_KEYS = /token|password|hash|secret/i;

/**
 * Klasa retencije (spec 01 §1.9.41): koliko dugo zapis mora ostati.
 *   STANDARD  2 g.  — obične izmjene
 *   ACCESS    5 g.  — pristup osjetljivim podacima, 2FA, support pristup
 *   FINANCIAL 10 g. — novac, obračuni, plate
 */
export type AuditRetentionClass = "STANDARD" | "ACCESS" | "FINANCIAL";

export type AuditEntry = {
  companyId: string;
  actorId: string | null;
  actorEmail: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
  /** Rola u trenutku radnje — role se mijenjaju, trag mora ostati tačan. */
  actorRole?: string | null;
  retentionClass?: AuditRetentionClass;
};

export function ipHash(ip: string): string {
  return createHash("sha256").update(ip, "utf8").digest("hex").slice(0, 32);
}

function assertNoSecrets(metadata: Record<string, unknown>): void {
  for (const key of Object.keys(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.test(key)) {
      throw new Error(
        `Audit metadata ne smije sadržavati polje "${key}" — tajne ne idu u trag (docs/PLAN-R1.md).`,
      );
    }
  }
}

/**
 * Upisuje trag. Zove se unutar `withCompany` transakcije, pa ako izmjena padne, pada i trag.
 */
export async function writeAudit(client: PoolClient, entry: AuditEntry): Promise<void> {
  const metadata = entry.metadata ?? {};
  assertNoSecrets(metadata);
  await client.query(
    `INSERT INTO audit_events
       (id, company_id, actor_id, actor_email, actor_role, action, entity_type, entity_id,
        metadata, ip_hash, retention_class)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
    [
      entry.companyId,
      entry.actorId,
      entry.actorEmail,
      entry.actorRole ?? null,
      entry.action,
      entry.entityType,
      entry.entityId,
      JSON.stringify(metadata),
      entry.ipHash ?? null,
      entry.retentionClass ?? "STANDARD",
    ],
  );
}

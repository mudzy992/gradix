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
] as const;

export const AUDIT_ENTITY_TYPES = ["invitation", "user", "session"] as const;

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
};

/** Tip je izveden iz spiska, pa se ne mogu razići: nova radnja se dodaje na JEDNO mjesto. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Polja koja se NIKAD ne upisuju u audit — provjerava se prije upisa, ne poslije. */
const FORBIDDEN_METADATA_KEYS = /token|password|hash|secret/i;

export type AuditEntry = {
  companyId: string;
  actorId: string | null;
  actorEmail: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
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
    `INSERT INTO audit_events (id, company_id, actor_id, actor_email, action, entity_type, entity_id, metadata, ip_hash)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      entry.companyId,
      entry.actorId,
      entry.actorEmail,
      entry.action,
      entry.entityType,
      entry.entityId,
      JSON.stringify(metadata),
      entry.ipHash ?? null,
    ],
  );
}

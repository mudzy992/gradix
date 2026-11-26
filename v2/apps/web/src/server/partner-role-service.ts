import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import type { PartnerRole } from "@gradix/contracts";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import type { FaultActor } from "./machine-fault-types";

export type PartnerRoleOutcome =
  | { outcome: "OK"; roles: { role: PartnerRole; isActive: boolean; primary: boolean }[] }
  | { outcome: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT"; message: string };

/** Svi upiti su ograničeni firmom, čak i kada se koristi administratorska konekcija. */
export async function partnerRoles(
  pool: Pool,
  actor: FaultActor,
  partnerId: string,
  change?: { role: PartnerRole; isActive: boolean; mustExist: boolean },
): Promise<PartnerRoleOutcome> {
  if (!can(actor.roles, "partners.manage")) return { outcome: "FORBIDDEN", message: "Nemate pravo upravljanja partnerima." };
  return withCompany(pool, companyId(actor.companyId), async (client) => {
    // Red partnera je zajednička brava s promjenom primarne uloge; dva paralelna zahtjeva
    // ne mogu deaktivirati ulogu koja istovremeno postaje primarna.
    const parent = await client.query<{ kind: PartnerRole }>(
      `SELECT kind FROM public.partners WHERE company_id = $1 AND id = $2 ${change ? "FOR UPDATE" : ""}`,
      [actor.companyId, partnerId],
    );
    if (!parent.rows[0]) return { outcome: "NOT_FOUND", message: "Partner nije pronađen." };
    if (change) {
      if (!change.isActive && change.role === parent.rows[0].kind) {
        return { outcome: "CONFLICT", message: "Primarna uloga partnera mora ostati aktivna." };
      }
      if (change.mustExist) {
        const updated = await client.query(
          `UPDATE public.partner_roles SET is_active = $4, updated_at = clock_timestamp()
            WHERE company_id = $1 AND partner_id = $2 AND role = $3`,
          [actor.companyId, partnerId, change.role, change.isActive],
        );
        if (!updated.rowCount) return { outcome: "NOT_FOUND", message: "Uloga nije pronađena." };
      } else {
        await client.query(
          `INSERT INTO public.partner_roles (id, company_id, partner_id, role, is_active)
           VALUES ($1,$2,$3,$4,true)
           ON CONFLICT (company_id, partner_id, role) DO UPDATE
             SET is_active = true, updated_at = clock_timestamp()`,
          [`pro_${randomUUID().replace(/-/g, "")}`, actor.companyId, partnerId, change.role],
        );
      }
      await writeAudit(client, {
        companyId: actor.companyId, actorId: actor.userId, actorEmail: null,
        action: "partner.role_changed", entityType: "partner", entityId: partnerId,
        metadata: { role: change.role, isActive: change.isActive }, retentionClass: "STANDARD",
      });
    }
    const result = await client.query<{ role: PartnerRole; is_active: boolean; primary: boolean }>(
      `SELECT pr.role, pr.is_active, pr.role = p.kind AS primary
         FROM public.partner_roles pr JOIN public.partners p
           ON p.company_id = pr.company_id AND p.id = pr.partner_id
        WHERE pr.company_id = $1 AND pr.partner_id = $2 ORDER BY pr.role`,
      [actor.companyId, partnerId],
    );
    return { outcome: "OK", roles: result.rows.map((row) => ({ role: row.role, isActive: row.is_active, primary: row.primary })) };
  });
}

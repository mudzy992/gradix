/**
 * PATCH /api/obligations/:id/review-at — datum do kojeg ured provjerava TRAJNU obavezu.
 *
 * Zašto zasebna ruta, a ne dio `PATCH /:id`: `review_at` nije ispravka podatka o dokumentu, nego
 * odluka „kad ćemo ovo opet pogledati“. Mijenja ga i rola koja ne smije mijenjati broj ni izdavaoca.
 *
 * Datum se NE smije postaviti na prošlost: to bi odmah stvorilo `expired` i blokiralo rad, a
 * radnja se zove „provjeri kasnije“, ne „proglasi nevažećim“.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { withCompany } from "@gradix/db";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { writeAudit } from "@/server/audit";
import { businessDate, safeTimezone } from "@gradix/domain";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const body = (await request.json().catch(() => null)) as { reviewAt?: unknown } | null;
    if (!body || typeof body.reviewAt !== "string" || !DATE_RE.test(body.reviewAt)) {
      return fail("VALIDATION_FAILED", "Datum provjere je obavezan (YYYY-MM-DD).");
    }
    const reviewAt = body.reviewAt;
    const { id } = await context.params;
    const ctx = guardResult.ctx;

    const outcome = await withCompany(await getVerifiedPool(), ctx.companyId, async (client) => {
      const company = await client.query<{ timezone: string | null }>(
        "SELECT timezone FROM companies WHERE id = $1",
        [ctx.companyId],
      );
      const today = businessDate(new Date(), safeTimezone(company.rows[0]?.timezone));
      if (reviewAt < today) {
        return { kind: "past" as const, today };
      }

      // Samo trajne obaveze imaju `review_at`. Za obavezu s rokom bi polje bilo mrtvo — a mrtvo
      // polje u bazi izgleda kao da nešto znači.
      const result = await client.query(
        `UPDATE obligations
            SET review_at = $3::date, updated_at = now()
          WHERE company_id = $1 AND id = $2 AND expires_at IS NULL`,
        [ctx.companyId, id, reviewAt],
      );
      if (result.rowCount === 0) {
        const exists = await client.query(
          "SELECT 1 FROM obligations WHERE company_id = $1 AND id = $2",
          [ctx.companyId, id],
        );
        return { kind: exists.rowCount === 0 ? ("not_found" as const) : ("has_expiry" as const) };
      }

      await writeAudit(client, {
        companyId: ctx.companyId,
        actorId: ctx.userId,
        actorEmail: null,
        action: "obligation.review_at_updated",
        entityType: "obligation",
        entityId: id,
        metadata: { reviewAt },
      });

      return { kind: "done" as const };
    });

    if (outcome.kind === "not_found") return fail("NOT_FOUND", "Obaveza ne postoji.");
    if (outcome.kind === "past") {
      return fail("VALIDATION_FAILED", "Datum provjere ne može biti u prošlosti.");
    }
    if (outcome.kind === "has_expiry") {
      return fail("VALIDATION_FAILED", "Obaveza ima rok — datum provjere važi samo za trajne obaveze.");
    }
    return ok({ id, reviewAt });
  } catch (error) {
    return internal(error, "obligations.review-at");
  }
}

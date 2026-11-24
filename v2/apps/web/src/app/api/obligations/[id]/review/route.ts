/**
 * POST /api/obligations/:id/review — potvrda ili odbijanje dokumenta (§17).
 *
 * Tok: `pending_review` → `none` (potvrđeno) ili `rejected` (uz obavezan razlog).
 *
 * Dvije stvari se provjeravaju prije upisa, i obje u servisu/bazi, ne u UI-u:
 *   1. odbijanje BEZ razloga se odbija (`obligations_review_note_required`) — odbijanje bez
 *      objašnjenja ne kaže radniku šta da popravi, pa se isti dokument šalje ponovo;
 *   2. `requires_attachment` tip prelazi u `pending_review` samo sa prilogom
 *      (`OBLIGATION_ATTACHMENT_REQUIRED`) — inače bi „čeka provjeru“ stajalo bez ijednog
 *      dokumenta koji bi se provjerio.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { withCompany } from "@gradix/db";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { writeAudit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.review");
    if (!guardResult.ok) return guardResult.response;

    const body = (await request.json().catch(() => null)) as {
      decision?: unknown;
      reason?: unknown;
    } | null;
    if (!body) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva.");

    const decision = body.decision;
    if (decision !== "approve" && decision !== "reject") {
      return fail("VALIDATION_FAILED", "Odluka mora biti „approve“ ili „reject“.");
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (decision === "reject" && (reason.length < 3 || reason.length > 1000)) {
      return fail("VALIDATION_FAILED", "Razlog odbijanja je obavezan (3–1000 znakova).");
    }

    const { id } = await context.params;
    const ctx = guardResult.ctx;

    const outcome = await withCompany(await getVerifiedPool(), ctx.companyId, async (client) => {
      // Dokument mora postojati, ali i biti u stanju koje se provjerava: potvrda obaveze koja
      // nikad nije poslana na provjeru bila bi način da se preskoči `requires_attachment`.
      const current = await client.query<{ review_state: string }>(
        "SELECT review_state FROM obligations WHERE company_id = $1 AND id = $2",
        [ctx.companyId, id],
      );
      if (current.rowCount === 0) return { kind: "not_found" as const };
      if (current.rows[0]!.review_state !== "pending_review") {
        return { kind: "not_pending" as const };
      }

      if (decision === "reject") {
        await client.query(
          `UPDATE obligations
              SET review_state = 'rejected', review_note = $3, reviewed_by = $4,
                  reviewed_at = now(), updated_at = now()
            WHERE company_id = $1 AND id = $2`,
          [ctx.companyId, id, reason, ctx.userId],
        );
      } else {
        // Potvrda briše stari razlog: ostaviti ga bi značilo da ekran prikazuje „odbijeno:
        // …“ uz dokument koji je odobren.
        await client.query(
          `UPDATE obligations
              SET review_state = 'none', review_note = NULL, reviewed_by = $3,
                  reviewed_at = now(), updated_at = now()
            WHERE company_id = $1 AND id = $2`,
          [ctx.companyId, id, ctx.userId],
        );
      }

      await writeAudit(client, {
        companyId: ctx.companyId,
        actorId: ctx.userId,
        actorEmail: null,
        action: decision === "reject" ? "obligation.review_rejected" : "obligation.review_approved",
        entityType: "obligation",
        entityId: id,
        // Razlog je sadržaj odluke, ne tajna — ide u trag da se zna zašto je dokument vraćen.
        metadata: decision === "reject" ? { reason } : {},
        retentionClass: "ACCESS",
      });

      return { kind: "done" as const };
    });

    if (outcome.kind === "not_found") return fail("NOT_FOUND", "Obaveza ne postoji.");
    if (outcome.kind === "not_pending") {
      return fail("OBLIGATION_REVIEW_REQUIRED", "Obaveza nije u stanju „čeka provjeru“.");
    }
    return ok({ id, decision });
  } catch (error) {
    return internal(error, "obligations.review");
  }
}

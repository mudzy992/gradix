/**
 * POST /api/obligations/bulk-renew — grupna obnova (§22).
 *
 * Tipičan slučaj: dvanaest radnika na projektu obnovilo je ljekarski istog dana. Bez ovoga se
 * isti datum upisuje dvanaest puta, a greška u jednom unosu se ne primijeti.
 *
 * Dvije vrste obnove, namjerno razdvojene:
 *   - obaveza SA rokom → nova verzija (`renewObligation`), stara ostaje kao historija;
 *   - TRAJNA obaveza (`expires_at IS NULL`) → pomjera se `review_at`, jer trajna obaveza nema
 *     rok koji bi se „obnovio“ — ima datum do kojeg je ured provjerava.
 *
 * Djelimičan uspjeh je dozvoljen i VIDLJIV: `failed` nosi razlog po obavezi. Alternativa
 * (sve ili ništa) bi značila da jedna tuđa obaveza u izboru obori obnovu svih ostalih.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { withCompany } from "@gradix/db";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { isServiceError, renewObligation } from "@/server/obligation-service";
import { bulkRenewObligations } from "@/server/obligation-requirement-service";
import { writeAudit } from "@/server/audit";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const body = (await request.json().catch(() => null)) as {
      obligationIds?: unknown;
      expiresAt?: unknown;
      reviewAt?: unknown;
      issuedAt?: unknown;
      number?: unknown;
      issuer?: unknown;
    } | null;
    if (!body || !Array.isArray(body.obligationIds) || body.obligationIds.length === 0) {
      return fail("VALIDATION_FAILED", "Izaberite barem jednu obavezu za obnovu.");
    }
    // Gornja granica: 200 obaveza po zahtjevu. Veće grupe su uvoz, ne obnova — a jedan zahtjev
    // koji drži transakciju nad hiljadama redova blokira ostale korisnike.
    if (body.obligationIds.length > 200) {
      return fail("VALIDATION_FAILED", "Najviše 200 obaveza po jednoj obnovi.");
    }
    const expiresAt = typeof body.expiresAt === "string" ? body.expiresAt : null;
    const reviewAt = typeof body.reviewAt === "string" ? body.reviewAt : null;
    if (expiresAt !== null && !DATE_RE.test(expiresAt)) {
      return fail("VALIDATION_FAILED", "Datum isteka nije ispravan (YYYY-MM-DD).");
    }
    if (reviewAt !== null && !DATE_RE.test(reviewAt)) {
      return fail("VALIDATION_FAILED", "Datum provjere nije ispravan (YYYY-MM-DD).");
    }
    if (expiresAt === null && reviewAt === null) {
      return fail(
        "VALIDATION_FAILED",
        "Za obaveze bez roka potreban je datum provjere — „trajno“ ne znači „neprovjereno“.",
      );
    }

    const ctx = guardResult.ctx;
    const pool = await getVerifiedPool();
    const ids = body.obligationIds.filter((value): value is string => typeof value === "string");
    const issuedAt = typeof body.issuedAt === "string" ? body.issuedAt : null;
    const number = typeof body.number === "string" ? body.number : null;
    const issuer = typeof body.issuer === "string" ? body.issuer : null;

    const result = await bulkRenewObligations(
      pool,
      ctx.companyId,
      { obligationIds: ids, expiresAt, reviewAt },
      { userId: ctx.userId, roles: ctx.roles },
      async (obligationId) => {
        // Trajna obaveza: nema nove verzije, samo novi datum provjere.
        if (expiresAt === null && reviewAt !== null) {
          const done = await withCompany(pool, ctx.companyId, async (client) => {
            const updated = await client.query(
              `UPDATE obligations SET review_at = $3::date, updated_at = now()
                WHERE company_id = $1 AND id = $2 AND expires_at IS NULL`,
              [ctx.companyId, obligationId, reviewAt],
            );
            if (updated.rowCount === 0) return false;
            await writeAudit(client, {
              companyId: ctx.companyId,
              actorId: ctx.userId,
              actorEmail: null,
              action: "obligation.review_at_updated",
              entityType: "obligation",
              entityId: obligationId,
              metadata: { reviewAt, bulk: true },
            });
            return true;
          });
          return done
            ? ({ ok: true, id: obligationId } as const)
            : ({ ok: false, reason: "Obaveza nije trajna ili ne postoji." } as const);
        }

        const renewed = await renewObligation(
          pool,
          ctx.companyId,
          { userId: ctx.userId, roles: ctx.roles },
          obligationId,
          { expiresAt: expiresAt as string, issuedAt, number, issuer },
        );
        if (isServiceError(renewed)) return { ok: false as const, reason: renewed.message };
        return { ok: true as const, id: obligationId };
      },
    );

    return ok(result);
  } catch (error) {
    return internal(error, "obligations.bulk-renew");
  }
}

import { hseRecordAllowed } from "@/server/hse-scope";
/** GET /api/hse/trainings/{id}/attendees — potpisi prisutnih (§1.4/19, 22). */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.training.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const ctx = guardResult.ctx;
    const data = await withCompany(await getVerifiedPool(), ctx.companyId, async (client) => {
      if (!await hseRecordAllowed(client, ctx, "training", id)) return null;
      const training = await client.query<{ id: string; title: string; kind: string; held_at: string }>(
        "SELECT id, title, kind, held_at::text FROM public.hse_trainings WHERE company_id = $1 AND id = $2",
        [ctx.companyId, id],
      );
      if (!training.rows[0]) return null;
      const attendees = await client.query<{
        worker_id: string; worker_name: string; signature_name: string; signed_at: string;
      }>(
        `SELECT a.worker_id, btrim(w.first_name || ' ' || coalesce(w.last_name, '')) AS worker_name,
                a.signature_name, a.signed_at::text
           FROM public.hse_training_attendees a
           JOIN public.workers w ON w.company_id = a.company_id AND w.id = a.worker_id
          WHERE a.company_id = $1 AND a.training_id = $2
          ORDER BY a.signed_at`,
        [ctx.companyId, id],
      );
      return {
        training: training.rows[0],
        attendees: attendees.rows.map((row) => ({
          workerId: row.worker_id,
          workerName: row.worker_name,
          signatureName: row.signature_name,
          signedAt: row.signed_at,
        })),
      };
    });
    if (!data) return fail("NOT_FOUND", "Obuka ne postoji.");
    return ok(data);
  } catch (error) {
    return internal(error, "hse.trainings.attendees");
  }
}

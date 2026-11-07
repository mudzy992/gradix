/**
 * POST /api/sync/push — offline zapisi sa uređaja.
 *
 * Pravila (packages/domain/src/sync.ts):
 *  - cijeli batch se validira PRIJE ijednog upisa; greška validacije = 400 za cijeli batch
 *  - idempotentnost: unique (company, user, device, localId) — ponovljeni zapis vraća postojeći
 *  - greška jednog zapisa ne obara ostale; odgovor nosi `results[]` po zapisu
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { validatePushBatch, type SyncPushItem } from "@gradix/domain";
import { z } from "zod";
import { fail, internal, ok } from "@/server/api";
import { getPool } from "@/server/db";
import { authenticate } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const itemSchema = z.object({
  localId: z.string(),
  entityType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  clientAt: z.string(),
});

const bodySchema = z.object({
  deviceId: z.string().min(1).max(100),
  items: z.array(itemSchema),
});

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return fail(auth.code, "Niste prijavljeni.");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan oblik zahtjeva.");

    const now = new Date();
    const items: SyncPushItem[] = parsed.data.items.map((item) => ({
      localId: item.localId,
      entityType: item.entityType as SyncPushItem["entityType"],
      payload: item.payload,
      clientAt: new Date(item.clientAt),
    }));

    const validation = validatePushBatch(items, now);
    if (!validation.ok) {
      const messages: Record<string, string> = {
        SYNC_BATCH_TOO_LARGE: "Batch mora imati između 1 i 200 zapisa.",
        SYNC_ENTITY_TYPE_UNKNOWN: "Nepoznat tip zapisa.",
        SYNC_LOCAL_ID_INVALID: "Neispravan ili dupli lokalni ID.",
        SYNC_CLIENT_AT_INVALID: "Vrijeme uređaja nije ispravno.",
      };
      return fail(validation.code, messages[validation.code] ?? "Neispravan batch.");
    }

    const results = await withCompany(getPool(), auth.ctx.companyId, async (client) => {
      const out: { localId: string; serverId: string; duplicate: boolean }[] = [];
      for (const item of items) {
        // ON CONFLICT DO NOTHING + ponovni SELECT: ponovljeni push vraća ISTI serverId.
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO sync_items (id, company_id, user_id, device_id, local_id, entity_type, payload, client_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::jsonb, $7)
           ON CONFLICT (company_id, user_id, device_id, local_id) DO NOTHING
           RETURNING id`,
          [
            auth.ctx.companyId,
            auth.ctx.userId,
            parsed.data.deviceId,
            item.localId,
            item.entityType,
            JSON.stringify(item.payload),
            item.clientAt,
          ],
        );
        const existing =
          inserted.rows[0] ??
          (
            await client.query<{ id: string }>(
              "SELECT id FROM sync_items WHERE company_id = $1 AND user_id = $2 AND device_id = $3 AND local_id = $4",
              [auth.ctx.companyId, auth.ctx.userId, parsed.data.deviceId, item.localId],
            )
          ).rows[0];
        out.push({
          localId: item.localId,
          serverId: existing?.id ?? "",
          duplicate: inserted.rows.length === 0,
        });
      }
      return out;
    });

    return ok({ results }, { accepted: results.filter((row) => !row.duplicate).length });
  } catch (error) {
    return internal(error, "sync.push");
  }
}

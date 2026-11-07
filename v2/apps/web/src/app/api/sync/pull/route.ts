/**
 * GET /api/sync/pull?since=<ISO> — zapisi poslije watermark-a.
 *
 * Watermark je najmanji `server_at` vraćenih redova: red na granici dolazi ponovo,
 * nijedan se ne preskače (v1 D-036). `since` u budućnosti je greška, ne prazan rezultat.
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { SYNC_PULL_LIMIT, isSinceValid, nextWatermark } from "@gradix/domain";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { authenticate } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return fail(auth.code, "Niste prijavljeni.");

    const now = new Date();
    const sinceParam = request.nextUrl.searchParams.get("since");
    const since = sinceParam ? new Date(sinceParam) : new Date(0);
    if (!isSinceValid(since, now)) {
      return fail("SYNC_SINCE_INVALID", "Vrijeme zadnjeg preuzimanja nije ispravno.");
    }

    const rows = await withCompany(await getVerifiedPool(), auth.ctx.companyId, async (client) => {
      const result = await client.query<{
        id: string;
        local_id: string;
        entity_type: string;
        payload: unknown;
        client_at: Date;
        server_at: Date;
      }>(
        `SELECT id, local_id, entity_type, payload, client_at, server_at
           FROM sync_items
          WHERE company_id = $1 AND server_at >= $2
          ORDER BY server_at ASC, id ASC
          LIMIT $3`,
        [auth.ctx.companyId, since, SYNC_PULL_LIMIT],
      );
      return result.rows;
    });

    const watermark = nextWatermark(rows.map((row) => ({ serverAt: row.server_at })), since);
    return ok(
      {
        items: rows.map((row) => ({
          serverId: row.id,
          localId: row.local_id,
          entityType: row.entity_type,
          payload: row.payload,
          clientAt: row.client_at.toISOString(),
        })),
      },
      { lastSyncTimestamp: watermark.toISOString(), serverTime: now.toISOString(), limit: SYNC_PULL_LIMIT },
    );
  } catch (error) {
    return internal(error, "sync.pull");
  }
}

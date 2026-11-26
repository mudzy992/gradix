import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { withPasskeyContext } from "@/server/passkey-store";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request); if (!auth.ok) return auth.response;
    const pool = await getVerifiedPool();
    const passkeys = await withPasskeyContext(pool, "app.passkey_user_id", auth.ctx.userId, async client => {
      const result = await client.query<{id: string; device_name: string; created_at: Date; last_used_at: Date | null}>(
        "SELECT id,device_name,created_at,last_used_at FROM public.user_passkeys WHERE user_id=$1 ORDER BY created_at DESC", [auth.ctx.userId]);
      return result.rows.map(row => ({id:row.id,deviceName:row.device_name,createdAt:row.created_at.toISOString(),lastUsedAt:row.last_used_at?.toISOString() ?? null}));
    });
    return ok({passkeys});
  } catch (error) { return internal(error,"auth.passkeys.list"); }
}

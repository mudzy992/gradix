import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { hasControlChars } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { ipHash, writeAudit } from "@/server/audit";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";
import { passkeyRequestOrigin } from "@/server/passkey-http";
export const dynamic = "force-dynamic";
export async function DELETE(request: NextRequest, {params}: {params: Promise<{id: string}>}): Promise<Response> {
  try {
    const auth = await guard(request); if (!auth.ok) return auth.response;
    const { id } = await params; if (!id || id.length > 128 || hasControlChars(id)) return fail("VALIDATION_FAILED", "Neispravan ID ključa.");
    try { passkeyRequestOrigin(request); } catch { return fail("FORBIDDEN", "Neispravno porijeklo zahtjeva."); }
    const deleted = await withCompany(await getVerifiedPool(), auth.ctx.companyId, async client => {
      await client.query("SELECT set_config('app.passkey_user_id',$1,true)", [auth.ctx.userId]);
      const result = await client.query("DELETE FROM public.user_passkeys WHERE id=$1 AND user_id=$2 RETURNING id", [id,auth.ctx.userId]);
      if (!result.rowCount) return false;
      await writeAudit(client,{companyId:auth.ctx.companyId,actorId:auth.ctx.userId,actorEmail:null,action:"passkey.deleted",entityType:"passkey",entityId:id,retentionClass:"ACCESS",ipHash:ipHash(clientIp(request))});
      return true;
    });
    if (!deleted) return fail("NOT_FOUND", "Ključ nije pronađen.");
    return ok({ok:true});
  } catch (error) { return internal(error,"auth.passkeys.delete"); }
}

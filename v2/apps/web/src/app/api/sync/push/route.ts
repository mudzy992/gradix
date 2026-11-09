/** POST /api/sync/push — tenant-scoped R4 workday/work-entry operations. */
import { Buffer } from "node:buffer";
import type { NextRequest } from "next/server";
import { SyncPushRequest } from "@gradix/contracts";
import {
  R4_SYNC_PUSH_MAX_BODY_BYTES,
  R4_SYNC_PUSH_MAX_ITEM_BYTES,
  validateR4SyncPush,
  type R4SyncPushItem,
} from "@gradix/domain";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { pushR4SyncItems, SyncPushAccessError } from "@/server/r4-sync-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readBoundedJson(request: NextRequest): Promise<
  { ok: true; value: unknown } | { ok: false; code: "SYNC_BODY_TOO_LARGE" | "SYNC_ITEM_INVALID" }
> {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader && /^\d+$/.test(lengthHeader) && Number(lengthHeader) > R4_SYNC_PUSH_MAX_BODY_BYTES) {
    return { ok: false, code: "SYNC_BODY_TOO_LARGE" };
  }
  if (!request.body) return { ok: false, code: "SYNC_ITEM_INVALID" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > R4_SYNC_PUSH_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "SYNC_BODY_TOO_LARGE" };
      }
      chunks.push(part.value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, code: "SYNC_ITEM_INVALID" };
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request);
    if (!auth.ok) return auth.response;
    if (!auth.ctx.roles.includes("WORKER")) {
      return fail("FORBIDDEN", "Samo radnik može slati vlastite radne zapise.");
    }

    const body = await readBoundedJson(request);
    if (!body.ok) {
      const message = body.code === "SYNC_BODY_TOO_LARGE"
        ? "JSON tijelo ne smije biti veće od 1 MiB."
        : "Tijelo zahtjeva nije ispravan JSON.";
      return fail(body.code, message);
    }
    if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
      return fail("SYNC_ITEM_INVALID", "Neispravan oblik sync zahtjeva.");
    }
    const rawItems = (body.value as { items?: unknown }).items;
    if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 100) {
      return fail("SYNC_BATCH_TOO_LARGE", "Batch mora imati između 1 i 100 stavki.");
    }
    for (const item of rawItems) {
      if (Buffer.byteLength(JSON.stringify(item), "utf8") > R4_SYNC_PUSH_MAX_ITEM_BYTES) {
        return fail("SYNC_ITEM_TOO_LARGE", "Pojedinačna sync stavka ne smije biti veća od 16 KiB.");
      }
    }

    const parsed = SyncPushRequest.safeParse(body.value);
    if (!parsed.success) {
      return fail("SYNC_ITEM_INVALID", "Neispravan oblik sync stavke.");
    }
    const items = parsed.data.items as R4SyncPushItem[];
    const validation = validateR4SyncPush(items);
    if (!validation.ok) {
      const messages: Record<string, string> = {
        SYNC_BATCH_TOO_LARGE: "Batch mora imati između 1 i 100 stavki.",
        SYNC_BODY_TOO_LARGE: "JSON tijelo ne smije biti veće od 1 MiB.",
        SYNC_ITEM_TOO_LARGE: "Pojedinačna sync stavka ne smije biti veća od 16 KiB.",
        SYNC_LOCAL_ID_INVALID: "Lokalni ID mora biti jedinstven UUID.",
        SYNC_ITEM_INVALID: "Jedna ili više sync stavki nije ispravna.",
      };
      return fail(validation.code, messages[validation.code] ?? "Neispravan sync zahtjev.");
    }

    const results = await pushR4SyncItems(await getVerifiedPool(), {
      userId: auth.ctx.userId,
      companyId: auth.ctx.companyId,
      roles: auth.ctx.roles,
    }, items);
    return ok({ results });
  } catch (error) {
    if (error instanceof SyncPushAccessError) {
      return error.code === "FORBIDDEN"
        ? fail("FORBIDDEN", "Nije dozvoljeno slati radne zapise za ovaj nalog.")
        : fail("NOT_FOUND", "Nalog nema aktivnu vezu s radnikom u ovoj firmi.");
    }
    return internal(error, "sync.push");
  }
}

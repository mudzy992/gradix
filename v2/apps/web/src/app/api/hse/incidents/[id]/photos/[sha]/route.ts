import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { hsePhotoDownload, resumeHsePhoto } from "@/server/hse-photo-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; sha: string }> }): Promise<Response> {
  try {
    const auth = await guard(request, "hse.view");
    if (!auth.ok) return auth.response;
    const { id, sha } = await context.params;
    const result = await hsePhotoDownload(await getVerifiedPool(), auth.ctx, id, sha);
    return result ? ok(result) : fail("NOT_FOUND", "Potvrđena fotografija nije dostupna.");
  } catch (error) { return internal(error, "hse.photo.url"); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; sha: string }> }): Promise<Response> {
  try {
    const auth = await guard(request, "hse.report");
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null) as { action?: unknown } | null;
    if (body?.action !== "UPLOAD_URL" && body?.action !== "CONFIRM") return fail("VALIDATION_FAILED", "Nepoznata radnja fotografije.");
    const { id, sha } = await context.params;
    const result = await resumeHsePhoto(await getVerifiedPool(), auth.ctx, id, sha, body.action);
    if (result.outcome === "OK") return ok(result);
    if (result.outcome === "STORAGE_UNAVAILABLE") return fail("INTERNAL", result.message);
    return fail(result.outcome, result.message);
  } catch (error) { return internal(error, "hse.photo"); }
}

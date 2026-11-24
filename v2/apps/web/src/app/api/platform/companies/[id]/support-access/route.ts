/**
 * POST /api/platform/companies/:id/support-access — vremenski ograničen pristup uz razlog.
 * Firma ga vidi u svom auditu i u zaglavlju dok traje (spec 01 §1.8.37). Nikad tiho.
 */
import type { NextRequest } from "next/server";
import { PlatformSupportAccessInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { PLATFORM_COOKIE, authenticatePlatform, grantSupportAccess } from "@/server/platform-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await authenticatePlatform(request.cookies.get(PLATFORM_COOKIE)?.value ?? null);
    if (!actor) return fail("PLATFORM_FORBIDDEN", "Pristup je dozvoljen samo operatoru platforme.");
    const parsed = PlatformSupportAccessInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Razlog i trajanje su obavezni.");
    }
    const { id } = await context.params;
    const result = await grantSupportAccess(actor, id, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok({ expiresAt: result.expiresAt.toISOString() });
  } catch (error) {
    return internal(error, "platform.support.grant");
  }
}

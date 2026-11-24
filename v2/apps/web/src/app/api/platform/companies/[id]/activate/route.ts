/** POST /api/platform/companies/:id/activate — reaktivacija firme. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { PLATFORM_COOKIE, authenticatePlatform, setCompanyActive } from "@/server/platform-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await authenticatePlatform(request.cookies.get(PLATFORM_COOKIE)?.value ?? null);
    if (!actor) return fail("PLATFORM_FORBIDDEN", "Pristup je dozvoljen samo operatoru platforme.");
    const { id } = await context.params;
    const result = await setCompanyActive(actor, id, true);
    if (!result.ok) return fail("NOT_FOUND", "Firma nije pronađena.");
    return ok({ ok: true });
  } catch (error) {
    return internal(error, "platform.companies.activate");
  }
}

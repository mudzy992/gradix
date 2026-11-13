/**
 * GET  /api/invitations/:token — pregled pozivnice PRIJE prijave (email, firma, rok).
 * POST /api/invitations/:token — prihvatanje: ime, prezime, lozinka → nalog + članstvo.
 *
 * Token se prima u putanji; ne loguje se. Polja iz odgovora su samo neosjetljiva.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok, type ErrorCode } from "@/server/api";
import { AcceptInvitationRequest } from "@gradix/contracts";
import { acceptInvitation, previewInvitation } from "@/server/access-service";
import { isValidTokenFormat } from "@/server/tokens";
import { getVerifiedPool } from "@/server/db";

export const dynamic = "force-dynamic";

const CODE_MAP: Record<string, ErrorCode> = {
  VALIDATION_FAILED: "AUTH_PASSWORD_WEAK",
  LINK_INVALID: "LINK_INVALID",
};

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { token } = await context.params;
    // Oblik se provjerava prije baze: smeće ne pravi upit.
    if (!isValidTokenFormat(token, "invite")) return fail("LINK_INVALID", "Link nije ispravan.");
    const preview = await previewInvitation(await getVerifiedPool(), token);
    if ("code" in preview) {
      return fail("LINK_INVALID", "Link je istekao ili je već iskorišten.");
    }
    return ok({ ...preview, expiresAt: preview.expiresAt.toISOString() });
  } catch (error) {
    return internal(error, "invitations.preview");
  }
}

export async function POST(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { token } = await context.params;
    if (!isValidTokenFormat(token, "invite")) return fail("LINK_INVALID", "Link nije ispravan.");
    const parsed = AcceptInvitationRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Ime, prezime i lozinka su obavezni.");

    const result = await acceptInvitation(await getVerifiedPool(), token, {
      ...parsed.data,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    });
    if ("code" in result) return fail(CODE_MAP[result.code] ?? "INTERNAL", result.message);
    return ok({ ok: true });
  } catch (error) {
    return internal(error, "invitations.accept");
  }
}

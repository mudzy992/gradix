/**
 * POST /api/auth/logout — opoziva TRENUTNU sesiju (ne sve).
 * Odjava na svim uređajima bi bila `logout-all`; nije u R0.
 */
import { NextResponse, type NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { revokeSession } from "@/server/auth-service";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/server/session";
import { authenticate } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return fail(auth.code, "Niste prijavljeni.");
    await revokeSession(auth.ctx.sessionId, auth.ctx.companyId);
    // Preglednička forma (meni u okviru) mora završiti na stranici prijave, ne na JSON
    // odgovoru (A2, 2026-11-07: odjava je ostavljala korisnika na {"loggedOut":true}).
    // API klijenti (fetch) i dalje dobijaju JSON.
    if ((request.headers.get("accept") ?? "").includes("text/html")) {
      const response = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
      response.cookies.delete(ACCESS_COOKIE);
      response.cookies.delete(REFRESH_COOKIE);
      return response;
    }
    const response = ok({ loggedOut: true });
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    return response;
  } catch (error) {
    return internal(error, "auth.logout");
  }
}

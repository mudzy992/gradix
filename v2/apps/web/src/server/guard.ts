/**
 * Jedan ulaz u zaštićene rute: sesija + dozvola + obavezna promjena lozinke.
 *
 * Zašto helper, a ne tri reda u svakoj ruti: pravilo „dok je `mustChangePassword`, smiješ
 * samo promijeniti lozinku“ mora važiti svuda. Kad se zaboravi u jednoj ruti, to je rupa
 * kroz koju privremena lozinka radi kao puna.
 */
import type { NextRequest } from "next/server";
import { fail } from "./api";
import { can, type Permission } from "./permissions";
import { authenticate, requiresPasswordChange, type AuthContext } from "./tenant-context";

export type GuardResult = { ok: true; ctx: AuthContext } | { ok: false; response: Response };

export async function guard(request: NextRequest, permission?: Permission): Promise<GuardResult> {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return { ok: false, response: fail(auth.code, "Niste prijavljeni.") };
  }

  const blocked = requiresPasswordChange(auth.ctx, request.nextUrl.pathname);
  if (blocked) {
    return {
      ok: false,
      response: fail(blocked, "Prvo postavite novu lozinku."),
    };
  }

  if (permission && !can(auth.ctx.roles, permission)) {
    return { ok: false, response: fail("FORBIDDEN", "Nemate pravo za ovu radnju.") };
  }

  return { ok: true, ctx: auth.ctx };
}

export function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

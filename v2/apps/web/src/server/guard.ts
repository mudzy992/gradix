/**
 * Jedan ulaz u zaštićene rute: sesija + dozvola + obavezna promjena lozinke.
 *
 * Zašto helper, a ne tri reda u svakoj ruti: pravilo „dok je `mustChangePassword`, smiješ
 * samo promijeniti lozinku“ mora važiti svuda. Kad se zaboravi u jednoj ruti, to je rupa
 * kroz koju privremena lozinka radi kao puna.
 */
import type { NextRequest } from "next/server";
import { hasControlChars } from "@gradix/contracts";
import { fail } from "./api";
import { can, type Permission } from "./permissions";
import { authenticate, requiresPasswordChange, type AuthContext } from "./tenant-context";

export type GuardResult = { ok: true; ctx: AuthContext } | { ok: false; response: Response };

export async function guard(request: NextRequest, permission?: Permission): Promise<GuardResult> {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return { ok: false, response: fail(auth.code, "Niste prijavljeni.") };
  }

  /*
   * A1 — ZAJEDNIČKI pomoćnik granice za kontrolne znakove, na SVAKOJ zaštićenoj ruti:
   * NUL i ostali kontrolni znakovi u query parametru nisu nikad legitiman unos. Bez ove
   * provjere stigli bi do baze (Postgres odbija NUL u stringu: SQLSTATE 22021) i rutu
   * bi srušili u 500. Ranije je ova petlja bila kopirana ruti po ruti — dvije su je
   * i zaboravile; sada je čuva jedno mjesto kroz koje prolazi svaki zahtjev sa sesijom.
   */
  for (const value of request.nextUrl.searchParams.values()) {
    if (hasControlChars(value)) {
      return { ok: false, response: fail("VALIDATION_FAILED", "Filter sadrži nedozvoljene kontrolne znakove.") };
    }
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

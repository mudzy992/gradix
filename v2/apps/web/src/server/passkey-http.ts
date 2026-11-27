import type { NextRequest, NextResponse } from "next/server";
import { passkeyOrigin } from "./passkey-origin";

export const REGISTER_COOKIE = "gx_pk_register";
export const LOGIN_COOKIE = "gx_pk_login";
export function passkeyRequestOrigin(request: NextRequest) {
  const config = passkeyOrigin(request.headers.get("host"));
  const incoming = request.headers.get("origin");
  if (incoming && incoming !== config.origin) throw new Error("WebAuthn Origin mismatch");
  return config;
}
export function setChallengeCookie(response: NextResponse, name: string, token: string) {
  response.cookies.set(name, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/api/auth/passkeys", maxAge: 300 });
}
export function clearChallengeCookie(response: NextResponse, name: string) {
  response.cookies.set(name, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/api/auth/passkeys", maxAge: 0 });
}

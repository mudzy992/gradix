/**
 * Pomoćnik za integracione testove: prijava naloga koji ima OBAVEZNU 2FA.
 *
 * Zašto postoji: od F1 svaka uredska rola (OWNER/ADMIN/ACCOUNTANT) mora imati 2FA, pa
 * `POST /api/auth/login` za takav nalog vraća `preAuthToken`, a NE sesiju. Testovi koji
 * pripremaju fiksturu (admin koji mijenja role, izvozi sate…) moraju proći i drugi korak.
 *
 * Ne dodaje „testni zaobilaz" u produkcijski kod: koristi iste rute koje koristi čovjek.
 * TOTP kod se računa iz tajne koja je u fiksturi upisana (`confirmed_at` postavljen).
 */
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { generateTotpSecret, encryptTotpSecret, totpCode, totpStep } from "@gradix/domain";
import { POST as twoFactorLoginRoute } from "@/app/api/auth/2fa/login/route";
import { PRE_AUTH_HEADER } from "@/server/pre-auth";

/** Tajna za TOTP koju test upisuje u bazu (`user_totp.secret_enc`, potvrđena). */
export function testTotpSecret(): { secret: string; encrypted: string } {
  const secret = generateTotpSecret();
  return { secret, encrypted: encryptTotpSecret(secret, process.env.AUTH_SECRET ?? "") };
}

export function codeFor(secret: string, now = new Date()): string {
  return totpCode(secret, totpStep(now.getTime()));
}

/**
 * Dovrši prijavu koju je prvi korak ostavio na 2FA vratima.
 *
 * `loginResponse` je odgovor `POST /api/auth/login` sa `data.preAuthToken`. Vraća isti
 * tip odgovora kao puna prijava, pa test dalje čita `gx_at` cookie na uobičajen način.
 */
/**
 * Briše „zadnji iskorišteni korak" za korisnika.
 *
 * TOTP replay zaštita (RFC 6238 §5.2, `user_totp.last_used_step`) odbija ISTI kod dvaput —
 * i to je ispravno u produkciji. U testu se, međutim, više prijava istog naloga izvrši u
 * istoj sekundi, pa bi fikstura padala na `AUTH_2FA_INVALID` iako kod nije greška. Zato
 * fikstura sama „zaboravi" zadnji korak poslije uspješne prijave; produkcijski kod se NE
 * mijenja zbog testa.
 */
let adminPool: Pool | null = null;
async function forgetLastUsedStep(userId: string): Promise<void> {
  if (!process.env.DATABASE_ADMIN_URL) return;
  if (!adminPool) {
    const { Pool } = await import("pg");
    adminPool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  }
  await adminPool.query("UPDATE user_totp SET last_used_step = NULL WHERE user_id = $1", [userId]);
}

export async function completeLogin(
  base: string,
  loginResponse: Response,
  secret: string,
  init?: { method?: string },
): Promise<Response> {
  const body = (await loginResponse.clone().json()) as {
    success: boolean;
    data?: { preAuthToken?: string; twoFactor?: { gate: string } };
  };
  const preAuthToken = body.data?.preAuthToken;
  if (!preAuthToken) {
    // Nalog nema obaveznu 2FA — prijava je već potpuna.
    return loginResponse;
  }
  const response = await twoFactorLoginRoute(
    new NextRequest(`${base}/api/auth/2fa/login`, {
      method: init?.method ?? "POST",
      body: JSON.stringify({ code: codeFor(secret) }),
      headers: { "content-type": "application/json", [PRE_AUTH_HEADER]: preAuthToken },
    }),
  );
  if (response.status === 200) {
    const done = (await response.clone().json()) as { data?: { user?: { id?: string } } };
    const userId = done.data?.user?.id;
    if (userId) await forgetLastUsedStep(userId);
  }
  return response;
}

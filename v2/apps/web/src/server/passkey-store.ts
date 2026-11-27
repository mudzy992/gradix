import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { identifierHash } from "./rate-limit";

/** NUL cannot occur in an accepted email, so this marker cannot alias an identified login. */
export function passkeyLoginIdentifier(email?: string): string {
  return identifierHash(email ?? "\0discoverable-passkey");
}

/** SET LOCAL is trusted server context, never a value supplied as an authenticated user ID by a client. */
export async function withPasskeyContext<T>(pool: Pool, setting: "app.passkey_user_id" | "app.webauthn_token_hash", value: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config($1,$2,true)", [setting, value]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export function newChallengeToken(): string { return randomBytes(32).toString("base64url"); }
export function challengeTokenHash(token: string): string | null {
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? createHash("sha256").update(token).digest("hex") : null;
}
export type Challenge = {
  challenge: string; purpose: "LOGIN" | "REGISTER"; user_id: string | null; session_id: string | null;
  login_identifier_hash: string | null; rp_id: string; origin: string; expires_at: Date;
};
export async function createChallenge(pool: Pool, token: string, data: Omit<Challenge, "expires_at">): Promise<void> {
  const hash = challengeTokenHash(token);
  if (!hash) throw new Error("Invalid challenge token");
  await pool.query("SELECT public.purge_expired_webauthn_challenges()");
  await withPasskeyContext(pool, "app.webauthn_token_hash", hash, client => client.query(
    `INSERT INTO public.webauthn_challenges(token_hash,challenge,purpose,user_id,session_id,login_identifier_hash,rp_id,origin)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [hash,data.challenge,data.purpose,data.user_id,data.session_id,data.login_identifier_hash,data.rp_id,data.origin],
  ).then(() => undefined));
}
/** Always commit the claim before verification: even invalid assertions cannot be replayed. */
export async function consumeChallenge(pool: Pool, token: string): Promise<Challenge | null> {
  const hash = challengeTokenHash(token);
  if (!hash) return null;
  return withPasskeyContext(pool, "app.webauthn_token_hash", hash, async client => {
    const result = await client.query<Challenge>(
      `DELETE FROM public.webauthn_challenges WHERE token_hash=$1
       RETURNING challenge,purpose,user_id,session_id,login_identifier_hash,rp_id,origin,expires_at`, [hash]);
    const row = result.rows[0];
    return row && row.expires_at.getTime() > Date.now() ? row : null;
  });
}

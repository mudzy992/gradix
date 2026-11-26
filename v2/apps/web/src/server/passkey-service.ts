import { randomUUID } from "node:crypto";
import { verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON, type AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { withCompany, type CompanyId } from "@gradix/db";
import { describeDevice, deviceFingerprint, refreshExpiry } from "@gradix/domain";
import type { Pool } from "pg";
import { ipHash, writeAudit } from "./audit";
import { hashRefreshToken, newRefreshToken } from "./session";
import type { AuthContext } from "./tenant-context";
import type { Challenge } from "./passkey-store";

export async function registerPasskey(pool: Pool, ctx: AuthContext, challenge: Challenge,
  response: RegistrationResponseJSON, deviceName: string, ip: string): Promise<boolean> {
  if (challenge.purpose !== "REGISTER" || challenge.user_id !== ctx.userId || challenge.session_id !== ctx.sessionId) return false;
  let result;
  try {
    result = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin, expectedRPID: challenge.rp_id, requireUserVerification: true });
  } catch { return false; }
  if (!result.verified || !result.registrationInfo.userVerified) return false;
  const credential = result.registrationInfo.credential;
  return withCompany(pool, ctx.companyId, async client => {
    await client.query("SELECT set_config('app.passkey_user_id',$1,true)", [ctx.userId]);
    const id = randomUUID();
    await client.query(`INSERT INTO public.user_passkeys(id,user_id,credential_id,public_key,counter,transports,device_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id,ctx.userId,credential.id,Buffer.from(credential.publicKey),credential.counter,credential.transports ?? [],deviceName]);
    await writeAudit(client, { companyId: ctx.companyId, actorId: ctx.userId, actorEmail: null, action: "passkey.registered", entityType: "passkey", entityId: id, retentionClass: "ACCESS", ipHash: ipHash(ip) });
    return true;
  });
}

export async function passkeyLogin(pool: Pool, userId: string, companyId: CompanyId, challenge: Challenge,
  response: AuthenticationResponseJSON, device: { userAgent: string | null; ip: string }) {
  if (challenge.purpose !== "LOGIN") return null;
  if (response.response.userHandle && response.response.userHandle !== Buffer.from(userId).toString("base64url")) return null;
  return withCompany(pool, companyId, async client => {
    await client.query("SELECT set_config('app.passkey_user_id',$1,true)", [userId]);
    const account = await client.query<{ is_active: boolean; locked_until: Date | null; must_change_password: boolean; first_name: string; last_name: string; roles: string[] }>(
      `SELECT u.is_active,u.locked_until,u.must_change_password,u.first_name,u.last_name,m.roles::text[] AS roles
         FROM public.users u JOIN public.memberships m ON m.user_id=u.id
         JOIN public.companies c ON c.id=m.company_id
        WHERE u.id=$1 AND m.company_id=$2 AND m.is_active AND c.is_active FOR UPDATE OF u`, [userId,companyId]);
    const user = account.rows[0];
    if (!user?.is_active || (user.locked_until && user.locked_until.getTime() > Date.now())) return null;
    const rows = await client.query<{ id: string; credential_id: string; public_key: Buffer; counter: string; transports: string[] }>(
      "SELECT id,credential_id,public_key,counter,transports FROM public.user_passkeys WHERE user_id=$1 AND credential_id=$2 FOR UPDATE", [userId,response.id]);
    const key = rows.rows[0];
    if (!key) return null;
    let verification;
    try {
      verification = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin, expectedRPID: challenge.rp_id, requireUserVerification: true,
        credential: { id: key.credential_id, publicKey: new Uint8Array(key.public_key), counter: Number(key.counter), transports: key.transports as AuthenticatorTransportFuture[] } });
    } catch { return null; }
    if (!verification.verified || !verification.authenticationInfo.userVerified) return null;
    // simplewebauthn rejects a non-increasing nonzero counter. Zero-counter passkeys are
    // valid WebAuthn devices; one-time challenges are still mandatory for anti-replay.
    await client.query("UPDATE public.user_passkeys SET counter=$1,last_used_at=now() WHERE id=$2 AND user_id=$3", [verification.authenticationInfo.newCounter,key.id,userId]);
    const now = new Date(), refreshToken = newRefreshToken(), fingerprint = deviceFingerprint(device.userAgent);
    await client.query("UPDATE public.sessions SET revoked_at=now() WHERE user_id=$1 AND company_id=$2 AND device_hash=$3 AND revoked_at IS NULL", [userId,companyId,fingerprint]);
    const session = await client.query<{ id: string }>(`INSERT INTO public.sessions
      (id,user_id,company_id,token_hash,expires_at,pwd_change_required,user_agent,device_label,device_hash,ip_hash,last_seen_at)
      VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [userId,companyId,hashRefreshToken(refreshToken),refreshExpiry(now),user.must_change_password,device.userAgent,describeDevice(device.userAgent),fingerprint,ipHash(device.ip),now]);
    await client.query("UPDATE public.users SET last_login_at=$1,failed_login_count=0,locked_until=NULL WHERE id=$2", [now,userId]);
    await writeAudit(client, { companyId, actorId: userId, actorEmail: null, action: "passkey.login", entityType: "passkey", entityId: key.id, retentionClass: "ACCESS", ipHash: ipHash(device.ip) });
    return { userId, companyId, sessionId: session.rows[0]!.id, refreshToken,
      mustChangePassword: user.must_change_password, roles: user.roles, displayName: `${user.first_name} ${user.last_name}`.trim() };
  });
}

import type { NextRequest } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { CompanyId } from "@gradix/db";
import { PasskeyLoginVerifyInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { lookupMemberships, lookupUserByEmail } from "@/server/auth-lookup";
import { getVerifiedPool } from "@/server/db";
import { clientIp } from "@/server/guard";
import { clearChallengeCookie, LOGIN_COOKIE, passkeyRequestOrigin } from "@/server/passkey-http";
import { passkeyLogin } from "@/server/passkey-service";
import { consumeChallenge, passkeyLoginIdentifier } from "@/server/passkey-store";
import { clearAttempts, rateLimitWait, recordAttempt } from "@/server/rate-limit";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOptions, issueAccessToken, refreshCookieOptions } from "@/server/session";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const parsed=PasskeyLoginVerifyInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) return fail("VALIDATION_FAILED","Neispravan odgovor ključa.");
    let origin;try{origin=passkeyRequestOrigin(request);}catch{return fail("FORBIDDEN","Neispravno porijeklo zahtjeva.");}
    const email=parsed.data.email?.toLowerCase(),pool=await getVerifiedPool(),ip=clientIp(request);
    const attemptKey=email ?? `passkey-discoverable-ip:${ip}`;
    const wait=await rateLimitWait(pool,attemptKey);
    if(wait){const r=fail("RATE_LIMITED",`Previše pokušaja. Pokušajte za ${wait} s.`);r.headers.set("Retry-After",String(wait));return r;}
    const challenge=await consumeChallenge(pool,request.cookies.get(LOGIN_COOKIE)?.value ?? "");
    if(!challenge || challenge.purpose!=="LOGIN" || challenge.login_identifier_hash!==passkeyLoginIdentifier(email) || challenge.origin!==origin.origin || challenge.rp_id!==origin.rpID)
      return fail("VALIDATION_FAILED","Izazov je istekao. Pokušajte ponovo.");
    const user=email ? await lookupUserByEmail(pool,email) : null;
    if(user?.locked_until && user.locked_until.getTime()>Date.now()) return fail("AUTH_ACCOUNT_LOCKED","Nalog je privremeno zaključan.");
    // A resident credential returns the opaque userHandle registered for this account.
    // Treat it as untrusted until passkeyLogin verifies the signature, handle, account and
    // credential together. No account information is returned for failed discovery.
    let userId=user?.is_active ? user.id : null;
    if (!email && parsed.data.credential.response.userHandle) {
      const handle=parsed.data.credential.response.userHandle;
      try {
        const bytes=Buffer.from(handle,"base64url");
        const decoded=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
        if(bytes.length > 0 && bytes.length <= 64 && bytes.toString("base64url")===handle && ![...decoded].some(char => { const point=char.codePointAt(0)!; return point < 32 || point === 127; })) userId=decoded;
      } catch { /* invalid handle: use the generic failed-login path */ }
    }
    const memberships=userId ? await lookupMemberships(pool,userId) : [];
    const membership=memberships.find(row=>row.company_active);
    const session=userId && membership ? await passkeyLogin(pool,userId,membership.company_id as CompanyId,challenge,parsed.data.credential as AuthenticationResponseJSON,{userAgent:request.headers.get("user-agent"),ip}) : null;
    if(!session){await recordAttempt(pool,attemptKey,ip);return fail("AUTH_INVALID_CREDENTIALS","Prijava passkey ključem nije uspjela.");}
    await clearAttempts(pool,attemptKey);
    const accessToken=issueAccessToken({sub:session.userId,sid:session.sessionId,companyId:session.companyId,...(session.mustChangePassword?{pwd:true}:{})});
    const result=ok({user:{id:session.userId,displayName:session.displayName,roles:session.roles},companyId:session.companyId,mustChangePassword:session.mustChangePassword,accessToken,refreshToken:session.refreshToken});
    result.cookies.set(ACCESS_COOKIE,accessToken,accessCookieOptions);result.cookies.set(REFRESH_COOKIE,session.refreshToken,refreshCookieOptions);clearChallengeCookie(result,LOGIN_COOKIE);return result;
  }catch(error){return internal(error,"auth.passkeys.login.verify");}
}

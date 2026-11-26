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
import { consumeChallenge } from "@/server/passkey-store";
import { clearAttempts, identifierHash, rateLimitWait, recordAttempt } from "@/server/rate-limit";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOptions, issueAccessToken, refreshCookieOptions } from "@/server/session";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const parsed=PasskeyLoginVerifyInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) return fail("VALIDATION_FAILED","Neispravan odgovor ključa.");
    let origin;try{origin=passkeyRequestOrigin(request);}catch{return fail("FORBIDDEN","Neispravno porijeklo zahtjeva.");}
    const email=parsed.data.email.toLowerCase(),pool=await getVerifiedPool(),ip=clientIp(request);
    const wait=await rateLimitWait(pool,email);
    if(wait){const r=fail("RATE_LIMITED",`Previše pokušaja. Pokušajte za ${wait} s.`);r.headers.set("Retry-After",String(wait));return r;}
    const challenge=await consumeChallenge(pool,request.cookies.get(LOGIN_COOKIE)?.value ?? "");
    if(!challenge || challenge.purpose!=="LOGIN" || challenge.login_identifier_hash!==identifierHash(email) || challenge.origin!==origin.origin || challenge.rp_id!==origin.rpID)
      return fail("VALIDATION_FAILED","Izazov je istekao. Pokušajte ponovo.");
    const user=await lookupUserByEmail(pool,email);
    if(user?.locked_until && user.locked_until.getTime()>Date.now()) return fail("AUTH_ACCOUNT_LOCKED","Nalog je privremeno zaključan.");
    const memberships=user?.is_active ? await lookupMemberships(pool,user.id) : [];
    const membership=memberships.find(row=>row.company_active);
    const session=user && membership ? await passkeyLogin(pool,user.id,membership.company_id as CompanyId,challenge,parsed.data.credential as AuthenticationResponseJSON,{userAgent:request.headers.get("user-agent"),ip}) : null;
    if(!session){await recordAttempt(pool,email,ip);return fail("AUTH_INVALID_CREDENTIALS","Prijava passkey ključem nije uspjela.");}
    await clearAttempts(pool,email);
    const accessToken=issueAccessToken({sub:session.userId,sid:session.sessionId,companyId:session.companyId,...(session.mustChangePassword?{pwd:true}:{})});
    const result=ok({user:{id:session.userId,displayName:session.displayName,roles:session.roles},companyId:session.companyId,mustChangePassword:session.mustChangePassword,accessToken,refreshToken:session.refreshToken});
    result.cookies.set(ACCESS_COOKIE,accessToken,accessCookieOptions);result.cookies.set(REFRESH_COOKIE,session.refreshToken,refreshCookieOptions);clearChallengeCookie(result,LOGIN_COOKIE);return result;
  }catch(error){return internal(error,"auth.passkeys.login.verify");}
}

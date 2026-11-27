import type { NextRequest } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { PasskeyLoginOptionsInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { clientIp } from "@/server/guard";
import { LOGIN_COOKIE, passkeyRequestOrigin, setChallengeCookie } from "@/server/passkey-http";
import { createChallenge, newChallengeToken, passkeyLoginIdentifier } from "@/server/passkey-store";
import { rateLimitWait, recordAttempt } from "@/server/rate-limit";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const parsed=PasskeyLoginOptionsInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) return fail("VALIDATION_FAILED","Unesite email.");
    let origin;try{origin=passkeyRequestOrigin(request);}catch{return fail("FORBIDDEN","Neispravno porijeklo zahtjeva.");}
    const email=parsed.data.email?.toLowerCase(),pool=await getVerifiedPool(),ip=clientIp(request),ipKey=`passkey-options-ip:${ip}`;
    const wait=Math.max(email ? await rateLimitWait(pool,email) : 0,await rateLimitWait(pool,ipKey));
    if(wait){const r=fail("RATE_LIMITED",`Previše pokušaja. Pokušajte za ${wait} s.`);r.headers.set("Retry-After",String(wait));return r;}
    await recordAttempt(pool,ipKey,ip);
    const options=await generateAuthenticationOptions({rpID:origin.rpID,userVerification:"required",timeout:300000});
    const token=newChallengeToken();
    await createChallenge(pool,token,{challenge:options.challenge,purpose:"LOGIN",user_id:null,session_id:null,login_identifier_hash:passkeyLoginIdentifier(email),rp_id:origin.rpID,origin:origin.origin});
    const response=ok({options});setChallengeCookie(response,LOGIN_COOKIE,token);return response;
  } catch(error){return internal(error,"auth.passkeys.login.options");}
}

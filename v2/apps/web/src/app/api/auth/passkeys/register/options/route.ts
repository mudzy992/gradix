import type { NextRequest } from "next/server";
import { generateRegistrationOptions, type AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { withCompany } from "@gradix/db";
import { PasskeyRegisterOptionsInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";
import { verifyPassword } from "@/server/password";
import { passkeyRequestOrigin, REGISTER_COOKIE, setChallengeCookie } from "@/server/passkey-http";
import { createChallenge, newChallengeToken, withPasskeyContext } from "@/server/passkey-store";
import { clearAttempts, rateLimitWait, recordAttempt } from "@/server/rate-limit";
import { verifyLoginCode } from "@/server/two-factor";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth=await guard(request); if(!auth.ok) return auth.response;
    let origin; try { origin=passkeyRequestOrigin(request); } catch { return fail("FORBIDDEN","Neispravno porijeklo zahtjeva."); }
    const input=PasskeyRegisterOptionsInput.safeParse(await request.json().catch(()=>null));
    if(!input.success) return fail("VALIDATION_FAILED","Lozinka i po potrebi 2FA kod su obavezni.");
    const pool=await getVerifiedPool(), attemptKey=`passkey-register:${auth.ctx.userId}`, ip=clientIp(request);
    if (await rateLimitWait(pool,attemptKey)) return fail("RATE_LIMITED","Previše pokušaja. Pokušajte kasnije.");
    const valid=await withCompany(pool,auth.ctx.companyId,async client=>{
      const result=await client.query<{email:string;password_hash:string;totp_enabled:boolean;locked_until:Date|null}>("SELECT email,password_hash,totp_enabled,locked_until FROM public.users WHERE id=$1 FOR UPDATE",[auth.ctx.userId]);
      const user=result.rows[0]; if(!user || (user.locked_until && user.locked_until.getTime() > Date.now()) || !await verifyPassword(user.password_hash,input.data.password)) return null;
      if(user.totp_enabled) await client.query("SELECT id FROM public.user_totp WHERE user_id=$1 FOR UPDATE", [auth.ctx.userId]);
      if(user.totp_enabled && !(await verifyLoginCode(client,auth.ctx.userId,input.data.code ?? "")).ok) return null;
      return user.email;
    });
    if(!valid) { await recordAttempt(pool,attemptKey,ip); return fail("AUTH_INVALID_CREDENTIALS","Ponovna autentikacija nije uspjela."); }
    await clearAttempts(pool,attemptKey);
    const keys=await withPasskeyContext(pool,"app.passkey_user_id",auth.ctx.userId,async client=>{
      const result=await client.query<{credential_id:string;transports:string[]}>("SELECT credential_id,transports FROM public.user_passkeys WHERE user_id=$1",[auth.ctx.userId]);
      return result.rows;
    });
    if(keys.length>=30) return fail("VALIDATION_FAILED","Dosegnut je limit od 30 ključeva.");
    const options=await generateRegistrationOptions({rpName:"Gradix",rpID:origin.rpID,userName:valid,userID:new TextEncoder().encode(auth.ctx.userId),attestationType:"none",timeout:300000,
      authenticatorSelection:{residentKey:"required",userVerification:"required"},excludeCredentials:keys.map(key=>({id:key.credential_id,transports:key.transports as AuthenticatorTransportFuture[]}))});
    const token=newChallengeToken();
    await createChallenge(pool,token,{challenge:options.challenge,purpose:"REGISTER",user_id:auth.ctx.userId,session_id:auth.ctx.sessionId,login_identifier_hash:null,rp_id:origin.rpID,origin:origin.origin});
    const response=ok({options});setChallengeCookie(response,REGISTER_COOKIE,token);return response;
  } catch(error) {return internal(error,"auth.passkeys.register.options");}
}

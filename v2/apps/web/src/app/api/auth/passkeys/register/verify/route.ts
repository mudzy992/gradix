import type { NextRequest } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { PasskeyRegisterVerifyInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";
import { clearChallengeCookie, passkeyRequestOrigin, REGISTER_COOKIE } from "@/server/passkey-http";
import { registerPasskey } from "@/server/passkey-service";
import { consumeChallenge } from "@/server/passkey-store";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth=await guard(request); if(!auth.ok) return auth.response;
    const parsed=PasskeyRegisterVerifyInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) return fail("VALIDATION_FAILED","Neispravan odgovor ili naziv uređaja.");
    let origin;try {origin=passkeyRequestOrigin(request);} catch {return fail("FORBIDDEN","Neispravno porijeklo zahtjeva.");}
    const pool=await getVerifiedPool(), challenge=await consumeChallenge(pool,request.cookies.get(REGISTER_COOKIE)?.value ?? "");
    if(!challenge || challenge.origin!==origin.origin || challenge.rp_id!==origin.rpID) return fail("VALIDATION_FAILED","Izazov je istekao. Pokušajte ponovo.");
    const success=await registerPasskey(pool,auth.ctx,challenge,parsed.data.credential as RegistrationResponseJSON,parsed.data.deviceName,clientIp(request));
    if(!success) return fail("VALIDATION_FAILED","Registracija ključa nije potvrđena.");
    const result=ok({ok:true});clearChallengeCookie(result,REGISTER_COOKIE);return result;
  } catch(error) {
    if ((error as {code?:string}).code === "23505") return fail("VALIDATION_FAILED", "Ovaj ključ je već registrovan.");
    return internal(error,"auth.passkeys.register.verify");
  }
}

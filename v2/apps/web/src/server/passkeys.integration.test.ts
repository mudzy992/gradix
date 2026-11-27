import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import argon2 from "argon2";
import { NextRequest } from "next/server";
import { totpCode, totpStep } from "@gradix/domain/server";
import { seedTotp } from "@/test/totp-fixture";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getVerifiedPool } from "./db";
import { resetConfigForTests } from "./config";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import { POST as registerOptions } from "../app/api/auth/passkeys/register/options/route";
import { POST as registerVerify } from "../app/api/auth/passkeys/register/verify/route";
import { POST as loginOptions } from "../app/api/auth/passkeys/login/options/route";
import { POST as loginVerify } from "../app/api/auth/passkeys/login/verify/route";
import { GET as list } from "../app/api/auth/passkeys/route";
import { DELETE as remove } from "../app/api/auth/passkeys/[id]/route";
vi.mock("./db",()=>({getVerifiedPool:vi.fn()}));
const adminUrl=process.env.DATABASE_ADMIN_URL,appUrl=process.env.DATABASE_URL;
const run=adminUrl && appUrl ? describe : describe.skip;
const name=`passkey_${process.pid}_${Date.now()}`;
const rootUrl=new URL(adminUrl ?? "postgresql://localhost/postgres");rootUrl.pathname="/postgres";
const dbUrl=new URL(rootUrl);dbUrl.pathname=`/${name}`;
const runtimeUrl=new URL(appUrl ?? "postgresql://localhost/postgres");runtimeUrl.pathname=`/${name}`;
const migrations=fileURLToPath(new URL("../../../../packages/db/migrations",import.meta.url));
const b64=(value:Buffer)=>value.toString("base64url");
const sha=(value:Buffer|string)=>createHash("sha256").update(value).digest();
// A minimal test-only CBOR encoder, generating a real `none` WebAuthn attestation.
function bytes(value:Buffer):Buffer { if(value.length < 24) return Buffer.concat([Buffer.from([0x40+value.length]),value]); if(value.length<256) return Buffer.concat([Buffer.from([0x58,value.length]),value]);return Buffer.concat([Buffer.from([0x59,value.length>>8,value.length&255]),value]); }
const text=(value:string)=>Buffer.concat([Buffer.from([0x60+Buffer.byteLength(value)]),Buffer.from(value)]);
function fixture() {
  const pair=generateKeyPairSync("ec",{namedCurve:"prime256v1"});const jwk=pair.publicKey.export({format:"jwk"});
  const id=randomBytes(24),x=Buffer.from(jwk.x!,"base64url"),y=Buffer.from(jwk.y!,"base64url");
  const cose=Buffer.concat([Buffer.from([0xa5,0x01,0x02,0x03,0x26,0x20,0x01,0x21]),bytes(x),Buffer.from([0x22]),bytes(y)]);
  function clientData(type:string,challenge:string,origin="http://localhost:3000") {return Buffer.from(JSON.stringify({type,challenge,origin,crossOrigin:false}));}
  function registration(challenge:string) {
    const len=Buffer.alloc(2);len.writeUInt16BE(id.length);
    const authData=Buffer.concat([sha("localhost"),Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),len,id,cose]);
    const attestation=Buffer.concat([Buffer.from([0xa3]),text("fmt"),text("none"),text("attStmt"),Buffer.from([0xa0]),text("authData"),bytes(authData)]);
    return {id:b64(id),rawId:b64(id),type:"public-key",clientExtensionResults:{},response:{clientDataJSON:b64(clientData("webauthn.create",challenge)),attestationObject:b64(attestation),transports:["internal"]}};
  }
  function assertion(challenge:string,counter:number,userId="pk-user",flags=0x05,origin="http://localhost:3000") {
    const c=Buffer.alloc(4);c.writeUInt32BE(counter);const authData=Buffer.concat([sha("localhost"),Buffer.from([flags]),c]);
    const data=clientData("webauthn.get",challenge,origin);const signature=sign("sha256",Buffer.concat([authData,sha(data)]),pair.privateKey);
    return {id:b64(id),rawId:b64(id),type:"public-key",clientExtensionResults:{},response:{clientDataJSON:b64(data),authenticatorData:b64(authData),signature:b64(signature),userHandle:b64(Buffer.from(userId))}};
  }
  return {registration,assertion};
}
run("Passkeys HTTP + RLS + stvarna WebAuthn kriptografija",()=>{
  const root=new Client(rootUrl.toString()),admin=new Client(dbUrl.toString());const app=new Pool({connectionString:runtimeUrl.toString()});
  const key=fixture();let cookie="",keyId="";
  const req=(path:string,body?:unknown,cookieValue="")=>new NextRequest(`http://localhost:3000${path}`,{method:body===undefined?"GET":"POST",headers:{host:"localhost:3000",origin:"http://localhost:3000",cookie:cookieValue,"content-type":"application/json","x-forwarded-for":"192.0.2.1"},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const getCookie=(response:Response,name:string)=>response.headers.getSetCookie().find(value=>value.startsWith(`${name}=`))!.split(";")[0]!;
  const data=async (response:Response)=>(await response.json() as {data:{options:{challenge:string};passkeys:{id:string}[]}}).data;
  beforeAll(async()=>{
    vi.stubEnv("AUTH_SECRET","test-secret-with-at-least-32-characters");vi.stubEnv("AUTH_LOGIN_LIMIT","50");vi.stubEnv("APP_URL","http://localhost:3000");vi.stubEnv("NEXT_PUBLIC_APP_URL","");resetConfigForTests();vi.mocked(getVerifiedPool).mockResolvedValue(app);
    await root.connect();await root.query(`CREATE DATABASE ${name}`);await admin.connect();
    await admin.query(readFileSync(fileURLToPath(new URL("../../../../packages/db/bootstrap/roles.sql",import.meta.url)),"utf8"));
    for(const dir of readdirSync(migrations).sort())await admin.query(readFileSync(`${migrations}/${dir}/migration.sql`,"utf8"));
    await admin.query(readFileSync(fileURLToPath(new URL("../../../../packages/db/bootstrap/grants.sql",import.meta.url)),"utf8"));
    const hash=await argon2.hash("TestPassword123");
    await admin.query("INSERT INTO companies(id,name,slug) VALUES ('pk-company','Passkeys','pk-company')");
    await admin.query("INSERT INTO users(id,email,first_name,last_name,password_hash,must_change_password) VALUES ('pk-user','pk@example.test','P','K',$1,false),('pk-other','other@example.test','O','T',$1,false)",[hash]);
    await admin.query(`INSERT INTO memberships(id,user_id,company_id,roles) VALUES ('pk-m','pk-user','pk-company',ARRAY['OWNER']::"Role"[]),('pk-m2','pk-other','pk-company',ARRAY['WORKER']::"Role"[])`);
    await admin.query("INSERT INTO sessions(id,user_id,company_id,token_hash,expires_at) VALUES ('pk-session','pk-user','pk-company','pk-session-hash',now()+interval '1 day'),('pk-session2','pk-other','pk-company','pk-session2-hash',now()+interval '1 day')");
    cookie=`${ACCESS_COOKIE}=${issueAccessToken({sub:"pk-user",sid:"pk-session",companyId:"pk-company"})}`;
  },120_000);
  afterAll(async()=>{await app.end();await admin.end();await root.query(`DROP DATABASE IF EXISTS ${name}`);await root.end();vi.unstubAllEnvs();resetConfigForTests();});
  it("registruje stvarni ključ samo poslije ponovne autentikacije; lista je korisnička",async()=>{
    expect((await registerOptions(req("/api/auth/passkeys/register/options",{password:"bad"},cookie))).status).toBe(401);
    const opts=await registerOptions(req("/api/auth/passkeys/register/options",{password:"TestPassword123"},cookie));expect(opts.status).toBe(200);
    const challenge=(await data(opts)).options.challenge,token=getCookie(opts,"gx_pk_register");
    const registered=await registerVerify(req("/api/auth/passkeys/register/verify",{deviceName:"Testni uređaj",credential:key.registration(challenge)},`${cookie}; ${token}`));
    expect(registered.status).toBe(200);
    const keys=await list(req("/api/auth/passkeys",undefined,cookie));expect(keys.status).toBe(200);keyId=(await data(keys)).passkeys[0]!.id;
    const replay=await registerVerify(req("/api/auth/passkeys/register/verify",{deviceName:"Drugi",credential:key.registration(challenge)},`${cookie}; ${token}`));expect(replay.status).toBe(400);
  });
  it("tuđa sesija ne može listati ni obrisati ključ",async()=>{
    const other=`${ACCESS_COOKIE}=${issueAccessToken({sub:"pk-other",sid:"pk-session2",companyId:"pk-company"})}`;
    expect((await data(await list(req("/api/auth/passkeys",undefined,other)))).passkeys).toEqual([]);
    const request=new NextRequest(`http://localhost:3000/api/auth/passkeys/${keyId}`,{method:"DELETE",headers:{host:"localhost:3000",origin:"http://localhost:3000",cookie:other}});
    expect((await remove(request,{params:Promise.resolve({id:keyId})})).status).toBe(404);
    expect((await data(await list(req("/api/auth/passkeys",undefined,cookie)))).passkeys).toHaveLength(1);
  });
  it("kad je TOTP uključen, za dodavanje traži tačan jednokratni kod",async()=>{
    const {secret}=await seedTotp(admin,"pk-user");
    expect((await registerOptions(req("/api/auth/passkeys/register/options",{password:"TestPassword123",code:"000000"},cookie))).status).toBe(401);
    const code=totpCode(secret,totpStep(Date.now()));
    expect((await registerOptions(req("/api/auth/passkeys/register/options",{password:"TestPassword123",code},cookie))).status).toBe(200);
    expect((await registerOptions(req("/api/auth/passkeys/register/options",{password:"TestPassword123",code},cookie))).status).toBe(401);
  });
  async function attempt(email:string,counter:number,handle="pk-user") {
    const opts=await loginOptions(req("/api/auth/passkeys/login/options",{email}));expect(opts.status).toBe(200);
    const challenge=(await data(opts)).options.challenge,token=getCookie(opts,"gx_pk_login");
    const response=await loginVerify(req("/api/auth/passkeys/login/verify",{email,credential:key.assertion(challenge,counter,handle)},token));
    return {response,challenge,token};
  }
  it("izdaje standardnu sesiju i odbija replay izazova i brojača",async()=>{
    const first=await attempt("pk@example.test",1);expect(first.response.status).toBe(200);
    expect(first.response.headers.getSetCookie().some(x=>x.startsWith(`${ACCESS_COOKIE}=`))).toBe(true);
    const replay=await loginVerify(req("/api/auth/passkeys/login/verify",{email:"pk@example.test",credential:key.assertion(first.challenge,2)},first.token));expect(replay.status).toBe(400);
    expect((await attempt("pk@example.test",1)).response.status).toBe(401);
    expect((await attempt("pk@example.test",2)).response.status).toBe(200);
  });
  it("odbija falsifikovani potpis, nedostatak korisničke verifikacije i pogrešan origin",async()=>{
    async function check(modify:(challenge:string)=>unknown) {
      const opts=await loginOptions(req("/api/auth/passkeys/login/options",{email:"pk@example.test"}));
      const challenge=(await data(opts)).options.challenge,token=getCookie(opts,"gx_pk_login");
      return loginVerify(req("/api/auth/passkeys/login/verify",{email:"pk@example.test",credential:modify(challenge)},token));
    }
    expect((await check(c=>{const value=key.assertion(c,3);value.response.signature="AAAA";return value;})).status).toBe(401);
    expect((await check(c=>key.assertion(c,3,"pk-user",0x01))).status).toBe(401);
    expect((await check(c=>key.assertion(c,3,"pk-user",0x05,"https://evil.test"))).status).toBe(401);
  });
  it("paralelne prijave s istim brojačem ne mogu obje uspjeti",async()=>{
    const opts=await Promise.all([0,1].map(()=>loginOptions(req("/api/auth/passkeys/login/options",{email:"pk@example.test"}))));
    const requests=await Promise.all(opts.map(async response=>{
      const challenge=(await data(response)).options.challenge,token=getCookie(response,"gx_pk_login");
      return loginVerify(req("/api/auth/passkeys/login/verify",{email:"pk@example.test",credential:key.assertion(challenge,3)},token));
    }));
    expect(requests.map(response=>response.status).sort()).toEqual([200,401]);
  });
  it("odbija tuđi ključ, istek, zaključan nalog i suspendovanu firmu",async()=>{
    expect((await attempt("other@example.test",3,"pk-other")).response.status).toBe(401);
    const opts=await loginOptions(req("/api/auth/passkeys/login/options",{email:"pk@example.test"}));const challenge=(await data(opts)).options.challenge,token=getCookie(opts,"gx_pk_login");
    await admin.query("UPDATE webauthn_challenges SET created_at=now()-interval '10 minutes',expires_at=now()-interval '5 minutes' WHERE challenge=$1",[challenge]);
    expect((await loginVerify(req("/api/auth/passkeys/login/verify",{email:"pk@example.test",credential:key.assertion(challenge,3)},token))).status).toBe(400);
    await admin.query("UPDATE users SET locked_until=now()+interval '1 hour' WHERE id='pk-user'");expect((await attempt("pk@example.test",3)).response.status).toBe(423);
    await admin.query("UPDATE users SET locked_until=NULL WHERE id='pk-user'");await admin.query("UPDATE companies SET is_active=false WHERE id='pk-company'");expect((await attempt("pk@example.test",3)).response.status).toBe(401);
    await admin.query("UPDATE companies SET is_active=true WHERE id='pk-company'");
  });
  it("discoverable prijava bez emaila provjerava handle, potpis, status i jednokratni izazov",async()=>{
    async function options() {
      const response=await loginOptions(req("/api/auth/passkeys/login/options",{}));
      expect(response.status).toBe(200);
      return {challenge:(await data(response)).options.challenge,token:getCookie(response,"gx_pk_login")};
    }
    let current=await options();
    expect((await loginVerify(req("/api/auth/passkeys/login/verify",{credential:key.assertion(current.challenge,4,"pk-other")},current.token))).status).toBe(401);
    current=await options();
    const bad=key.assertion(current.challenge,4);bad.response.signature="AAAA";
    expect((await loginVerify(req("/api/auth/passkeys/login/verify",{credential:bad},current.token))).status).toBe(401);
    current=await options();
    expect((await loginVerify(req("/api/auth/passkeys/login/verify",{email:"pk@example.test",credential:key.assertion(current.challenge,4)},current.token))).status).toBe(400);
    await admin.query("UPDATE users SET locked_until=now()+interval '1 hour' WHERE id='pk-user'");
    current=await options();
    expect((await loginVerify(req("/api/auth/passkeys/login/verify",{credential:key.assertion(current.challenge,4)},current.token))).status).toBe(401);
    await admin.query("UPDATE users SET locked_until=NULL WHERE id='pk-user'");
    current=await options();
    const payload={credential:key.assertion(current.challenge,4)};
    const response=await loginVerify(req("/api/auth/passkeys/login/verify",payload,current.token));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some(value=>value.startsWith(`${ACCESS_COOKIE}=`))).toBe(true);
    expect((await loginVerify(req("/api/auth/passkeys/login/verify",payload,current.token))).status).toBe(400);
  });
  it("brisanje samo vlastitog ključa ostavlja ACCESS audit",async()=>{
    const request=new NextRequest(`http://localhost:3000/api/auth/passkeys/${keyId}`,{method:"DELETE",headers:{host:"localhost:3000",origin:"http://localhost:3000",cookie}});
    const response=await remove(request,{params:Promise.resolve({id:keyId})});expect(response.status).toBe(200);
    expect((await admin.query("SELECT action,retention_class FROM audit_events WHERE entity_id=$1 ORDER BY created_at",[keyId])).rows).toEqual([
      {action:"passkey.registered",retention_class:"ACCESS"},{action:"passkey.login",retention_class:"ACCESS"},{action:"passkey.login",retention_class:"ACCESS"},{action:"passkey.login",retention_class:"ACCESS"},{action:"passkey.login",retention_class:"ACCESS"},{action:"passkey.deleted",retention_class:"ACCESS"},
    ]);
  });
});

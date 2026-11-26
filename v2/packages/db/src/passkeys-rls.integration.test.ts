import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
const run = adminUrl && appUrl ? describe : describe.skip;
const name = `passkey_rls_${process.pid}_${Date.now()}`;
const rootUrl = new URL(adminUrl ?? "postgresql://localhost/postgres");
rootUrl.pathname = "/postgres";
const dbUrl = new URL(rootUrl); dbUrl.pathname = `/${name}`;
const runtimeUrl = new URL(appUrl ?? "postgresql://localhost/postgres"); runtimeUrl.pathname = `/${name}`;
const migrations = fileURLToPath(new URL("../migrations", import.meta.url));
const tokenA = "a".repeat(64), tokenB = "b".repeat(64);

run("WebAuthn RLS u stvarnoj bazi", () => {
  const root = new Client(rootUrl.toString()), admin = new Client(dbUrl.toString());
  const app = new Pool({ connectionString: runtimeUrl.toString(), max: 1 });
  beforeAll(async () => {
    await root.connect(); await root.query(`CREATE DATABASE ${name}`); await admin.connect();
    await admin.query(readFileSync(fileURLToPath(new URL("../bootstrap/roles.sql", import.meta.url)), "utf8"));
    for (const dir of readdirSync(migrations).sort()) await admin.query(readFileSync(`${migrations}/${dir}/migration.sql`, "utf8"));
    await admin.query(readFileSync(fileURLToPath(new URL("../bootstrap/grants.sql", import.meta.url)), "utf8"));
    await admin.query(`INSERT INTO users(id,email,password_hash,first_name,last_name) VALUES
      ('user-a','passkey-a@example.test','x','A','A'), ('user-b','passkey-b@example.test','x','B','B')`);
    await admin.query(`INSERT INTO user_passkeys(id,user_id,credential_id,public_key,device_name)
      VALUES ('key-a','user-a','cred-a',decode('01','hex'),'A'), ('key-b','user-b','cred-b',decode('02','hex'),'B')`);
    await admin.query(`INSERT INTO webauthn_challenges(token_hash,challenge,purpose,login_identifier_hash,rp_id,origin)
      VALUES ($1,'random-a','LOGIN','hash-a','localhost','http://localhost'),
             ($2,'random-b','LOGIN','hash-b','localhost','http://localhost')`, [tokenA, tokenB]);
  }, 120_000);
  afterAll(async () => { await app.end(); await admin.end(); await root.query(`DROP DATABASE IF EXISTS ${name}`); await root.end(); });

  async function scoped<T>(setting: string, value: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config($1,$2,true)", [setting, value]);
      const result = await fn(client); await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  it("ne otkriva niti dopušta izmjenu tuđeg ključa, ni bez konteksta", async () => {
    expect((await app.query("SELECT id FROM user_passkeys")).rows).toEqual([]);
    await scoped("app.passkey_user_id", "user-a", async client => {
      expect((await client.query("SELECT id FROM user_passkeys ORDER BY id")).rows).toEqual([{ id: "key-a" }]);
      expect((await client.query("DELETE FROM user_passkeys WHERE id='key-b'")).rowCount).toBe(0);
      expect((await client.query("UPDATE user_passkeys SET counter=99 WHERE id='key-b'")).rowCount).toBe(0);
    });
    expect((await app.query("SELECT id FROM user_passkeys")).rows).toEqual([]);
    await expect(scoped("app.passkey_user_id", "user-a", client => client.query(
      "INSERT INTO user_passkeys(id,user_id,credential_id,public_key,device_name) VALUES ('bad','user-b','bad',decode('01','hex'),'bad')",
    ))).rejects.toThrow();
  });
  it("izazove izoluje po tokenu i omogućava jednokratni claim", async () => {
    expect((await app.query("SELECT token_hash FROM webauthn_challenges")).rows).toEqual([]);
    await scoped("app.webauthn_token_hash", tokenA, async client => {
      expect((await client.query("SELECT token_hash FROM webauthn_challenges")).rows).toEqual([{ token_hash: tokenA }]);
      expect((await client.query("DELETE FROM webauthn_challenges WHERE token_hash=$1", [tokenB])).rowCount).toBe(0);
      expect((await client.query("DELETE FROM webauthn_challenges WHERE token_hash=$1 RETURNING challenge", [tokenA])).rows).toEqual([{ challenge: "random-a" }]);
      expect((await client.query("DELETE FROM webauthn_challenges WHERE token_hash=$1", [tokenA])).rowCount).toBe(0);
    });
    expect((await app.query("SELECT token_hash FROM webauthn_challenges")).rows).toEqual([]);
  });
  it("ograničava život izazova i dozvole", async () => {
    await expect(scoped("app.webauthn_token_hash", "c".repeat(64), client => client.query(
      `INSERT INTO webauthn_challenges(token_hash,challenge,purpose,login_identifier_hash,rp_id,origin,expires_at)
       VALUES ($1,'x','LOGIN','x','localhost','http://localhost',now()+interval '6 minutes')`, ["c".repeat(64)],
    ))).rejects.toThrow();
    await expect(app.query("UPDATE webauthn_challenges SET challenge='x'")).rejects.toThrow();
  });
  it("cleanup radi i kada vlasnik migracije nije superuser, bez čitanja aktivnih izazova", async () => {
    const owner = `pk_owner_${process.pid}`;
    await admin.query("DROP TABLE public.webauthn_challenges, public.user_passkeys CASCADE; DROP FUNCTION public.purge_expired_webauthn_challenges()");
    await admin.query(`CREATE ROLE ${owner} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    try {
      await admin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${owner}; GRANT REFERENCES ON public.users TO ${owner}; GRANT SELECT,INSERT ON public.schema_migrations TO ${owner}`);
      await admin.query(`SET ROLE ${owner}`);
      try { await admin.query(readFileSync(`${migrations}/20261130100000_f11_5_passkeys/migration.sql`, "utf8")); }
      finally { await admin.query("RESET ROLE"); }
      await admin.query("GRANT SELECT,INSERT,DELETE ON public.webauthn_challenges TO gradix_app");
      await admin.query(`INSERT INTO webauthn_challenges(token_hash,challenge,purpose,login_identifier_hash,rp_id,origin,created_at,expires_at)
        VALUES ($1,'expired','LOGIN','h','localhost','http://localhost',now()-interval '10 minutes',now()-interval '5 minutes'),
               ($2,'active','LOGIN','h','localhost','http://localhost',now(),now()+interval '5 minutes')`,[tokenA,tokenB]);
      await app.query("SELECT public.purge_expired_webauthn_challenges()");
      expect((await admin.query("SELECT challenge FROM webauthn_challenges ORDER BY challenge")).rows).toEqual([{challenge:"active"}]);
      expect((await app.query("SELECT token_hash FROM webauthn_challenges")).rows).toEqual([]);
    } finally {
      await admin.query("DROP TABLE IF EXISTS public.webauthn_challenges, public.user_passkeys CASCADE; DROP FUNCTION IF EXISTS public.purge_expired_webauthn_challenges()");
      await admin.query(`DROP OWNED BY ${owner}; DROP ROLE ${owner}`);
    }
  });

});

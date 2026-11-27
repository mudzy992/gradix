import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync,readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import argon2 from "argon2";
import { afterAll,beforeAll,describe,expect,it } from "vitest";

const run=promisify(execFile);
const adminUrl=process.env.DATABASE_ADMIN_URL;
const describeDb=adminUrl ? describe : describe.skip;
const name=`gradix_pilot_reset_${process.pid}_${Date.now()}`;
const rootUrl=new URL(adminUrl ?? 'postgresql://localhost/postgres');rootUrl.pathname='/postgres';
const dbUrl=new URL(rootUrl);dbUrl.pathname=`/${name}`;
const migrations=fileURLToPath(new URL('../../../../packages/db/migrations',import.meta.url));
const bootstrap=fileURLToPath(new URL('../../../../packages/db/bootstrap',import.meta.url));
const password='Pilot-Integration-Test-2026!';

describeDb('čisti pilot reset na izolovanoj bazi',()=>{
  const root=new Client(rootUrl.toString());const db=new Client(dbUrl.toString());
  const execute=(args:string[])=>run(process.execPath,process.env.PILOT_RESET_BUNDLE
    ? [process.env.PILOT_RESET_BUNDLE,...args]
    : ['--import','tsx','scripts/reset-pilot-clean.ts',...args],{
    cwd:fileURLToPath(new URL('../..',import.meta.url)),env:{...process.env,DATABASE_ADMIN_URL:dbUrl.toString(),PILOT_TEST_PASSWORD:password},
  });
  beforeAll(async()=>{
    await root.connect();await root.query(`CREATE DATABASE ${name}`);await db.connect();
    await db.query(readFileSync(`${bootstrap}/roles.sql`,'utf8'));
    for(const dir of readdirSync(migrations).sort()) await db.query(readFileSync(`${migrations}/${dir}/migration.sql`,'utf8'));
    await db.query(readFileSync(`${bootstrap}/grants.sql`,'utf8'));
    await db.query("INSERT INTO companies(id,name,slug) VALUES('old','Old demo','old-demo')");
    await run(process.execPath,['--input-type=module','-e',`import PgBoss from 'pg-boss'; const boss=new PgBoss({connectionString:process.env.DATABASE_ADMIN_URL,schema:'pgboss'}); await boss.start(); await boss.createQueue('old-pilot'); await boss.send('old-pilot',{companyId:'old'}); await boss.stop();`],{
      cwd:fileURLToPath(new URL('../../../worker',import.meta.url)),env:{...process.env,DATABASE_ADMIN_URL:dbUrl.toString()},
    });
  },120_000);
  afterAll(async()=>{await db.end();await root.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await root.end();});
  it('bez potvrde ili s pogrešnom bazom ne briše; potvrđeni reset je ponovljiv i čist',async()=>{
    await expect(execute([])).rejects.toThrow();
    await expect(execute(['--delete-all-pilot-data','--confirm-db=wrong_pilot'])).rejects.toThrow();
    expect((await db.query("SELECT count(*)::int AS n FROM companies")).rows[0].n).toBe(1);
    const flags=['--delete-all-pilot-data',`--confirm-db=${name}`];
    await db.query('ALTER TABLE pgboss.archive RENAME TO archive_hidden');
    await expect(execute(flags)).rejects.toThrow();
    expect((await db.query("SELECT id FROM companies")).rows).toEqual([{id:'old'}]);
    expect((await db.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.project_assignments'::regclass AND tgname='project_assignments_truncate_guard'")).rows[0].tgenabled).toBe('O');
    await db.query('ALTER TABLE pgboss.archive_hidden RENAME TO archive');
    await execute(flags);await execute(flags);
    expect((await db.query("SELECT count(*)::int AS n FROM pgboss.job")).rows[0].n).toBe(0);
    expect((await db.query("SELECT id,name FROM companies")).rows).toEqual([{id:'cmp_pilot',name:'Gradix Niskogradnja d.o.o. Zenica'}]);
    const users=await db.query("SELECT email,password_hash,must_enroll_2fa FROM users ORDER BY email");
    expect(users.rows).toHaveLength(6);
    for(const user of users.rows) expect(await argon2.verify(user.password_hash,password)).toBe(true);
    expect(users.rows.filter(u=>u.must_enroll_2fa).map(u=>u.email)).toEqual(['racunovodja@pilot.test','vlasnik@pilot.test']);
    for(const table of ['projects','machines','workdays','work_entries','hauls','fuel_entries','service_orders','stock_movements','pay_periods','notifications','hse_incidents','tenders'])
      expect((await db.query(`SELECT count(*)::int AS n FROM public."${table}"`)).rows[0].n).toBe(0);
    for(const table of ['cost_categories','payroll_components','payroll_parameters','check_templates','obligation_types','warehouses','fuel_tanks'])
      expect((await db.query(`SELECT count(*)::int AS n FROM public."${table}"`)).rows[0].n,table).toBeGreaterThan(0);
    // Real application login under the restricted runtime principal: no shortcut sessions.
    if(process.env.DATABASE_URL) {
      const appUrl=new URL(process.env.DATABASE_URL);appUrl.pathname=`/${name}`;
      const loginScript=`import {login} from './src/server/auth-service.ts'; import argon2 from 'argon2';
        const owner=await login('vlasnik@pilot.test',process.env.PILOT_TEST_PASSWORD,(h,p)=>argon2.verify(h,p));
        const worker=await login('radnik@pilot.test',process.env.PILOT_TEST_PASSWORD,(h,p)=>argon2.verify(h,p));
        if(owner.code!=='AUTH_2FA_REQUIRED'||owner.gate!=='ENROLL'||!worker.sessionId) throw Error('pilot login failed');
        process.exit(0);`;
      await run(process.execPath,['--import','tsx','--input-type=module','-e',loginScript],{
        cwd:fileURLToPath(new URL('../..',import.meta.url)),env:{...process.env,DATABASE_URL:appUrl.toString(),PILOT_TEST_PASSWORD:password},
      });
    }
    const roles=await db.query("SELECT unnest(roles)::text AS role FROM memberships ORDER BY role");
    expect(roles.rows.map(r=>r.role)).toEqual(['ACCOUNTANT','MECHANIC','OWNER','PROJECT_MANAGER','SITE_SUPERVISOR','WORKER']);
  },120_000);

  it('ne-pilot baza traži izričiti flag i sve ostale zaštite, a potvrđeni reset uspijeva',async()=>{
    // The exact-name mode is used ONLY against a fresh isolated cluster: CREATE fails rather
    // than touching an existing gradix database, and cleanup drops only what this test created.
    const nonPilotName=process.env.PILOT_RESET_TEST_EXACT_GRADIX === '1' ? 'gradix' : `gradix_reset_${process.pid}_${Date.now()}`;
    const nonPilotUrl=new URL(rootUrl);nonPilotUrl.pathname=`/${nonPilotName}`;
    const nonPilot=new Client(nonPilotUrl.toString());
    let created=false;
    const executeNonPilot=(args:string[], env:Record<string,string>={})=>run(process.execPath,process.env.PILOT_RESET_BUNDLE
      ? [process.env.PILOT_RESET_BUNDLE,...args]
      : ['--import','tsx','scripts/reset-pilot-clean.ts',...args],{
      cwd:fileURLToPath(new URL('../..',import.meta.url)),
      env:{...process.env,DATABASE_ADMIN_URL:nonPilotUrl.toString(),BOSS_DATABASE_URL:'',PILOT_TEST_PASSWORD:password,...env},
    });
    try {
      await root.query(`CREATE DATABASE "${nonPilotName}"`);created=true;await nonPilot.connect();
      await nonPilot.query(readFileSync(`${bootstrap}/roles.sql`,'utf8'));
      for(const dir of readdirSync(migrations).sort()) await nonPilot.query(readFileSync(`${migrations}/${dir}/migration.sql`,'utf8'));
      await nonPilot.query(readFileSync(`${bootstrap}/grants.sql`,'utf8'));
      await nonPilot.query("INSERT INTO companies(id,name,slug) VALUES('old_nonpilot','Old staging','old-staging')");
      const confirm=`--confirm-db=${nonPilotName}`;
      const flags=['--delete-all-pilot-data','--allow-non-pilot-db',confirm];
      await expect(executeNonPilot(['--delete-all-pilot-data',confirm])).rejects.toThrow(/--allow-non-pilot-db/);
      await expect(executeNonPilot(['--allow-non-pilot-db',confirm])).rejects.toThrow();
      await expect(executeNonPilot(['--delete-all-pilot-data','--allow-non-pilot-db','--confirm-db=wrong'])).rejects.toThrow();
      await expect(executeNonPilot(flags,{PILOT_TEST_PASSWORD:'short'})).rejects.toThrow();
      await expect(executeNonPilot(['--delete-all-pilot-data','--allow-non-pilot-db','--confirm-db=postgres'],{DATABASE_ADMIN_URL:rootUrl.toString()})).rejects.toThrow(/sistemske baze/);
      await expect(executeNonPilot(flags,{BOSS_DATABASE_URL:rootUrl.toString()})).rejects.toThrow(/Zasebna baza reda/);
      expect((await nonPilot.query("SELECT id FROM companies")).rows).toEqual([{id:'old_nonpilot'}]);
      await executeNonPilot(flags);
      expect((await nonPilot.query("SELECT id FROM companies")).rows).toEqual([{id:'cmp_pilot'}]);
      expect((await nonPilot.query("SELECT count(*)::int AS n FROM users")).rows[0].n).toBe(6);
    } finally {
      await nonPilot.end();
      if(created) await root.query(`DROP DATABASE "${nonPilotName}" WITH (FORCE)`);
    }
  },120_000);
});

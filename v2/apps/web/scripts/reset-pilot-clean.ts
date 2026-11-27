/** DESTRUCTIVE: dedicated pilot database only; a single transaction or no change. */
import { Pool } from "pg";
import argon2 from "argon2";

const url=process.env.DATABASE_ADMIN_URL;
const password=process.env.PILOT_TEST_PASSWORD;
const confirm=process.argv.find(a=>a.startsWith("--confirm-db="))?.slice("--confirm-db=".length);
if (!url || !password || password.length < 12 || !process.argv.includes("--delete-all-pilot-data") || !confirm)
  throw new Error("Potrebni su DATABASE_ADMIN_URL, PILOT_TEST_PASSWORD (min. 12 znakova), --delete-all-pilot-data i --confirm-db=IME_BAZE. Operacija briše SVE podatke baze!");
const parsed=new URL(url);
const expected=decodeURIComponent(parsed.pathname.slice(1));
if (!expected || confirm!==expected || !/pilot/i.test(expected) || ["postgres","template0","template1"].includes(expected))
  throw new Error("Potvrda mora odgovarati imenu namjenske baze koje sadrži 'pilot'.");
if (process.env.BOSS_DATABASE_URL) {
  const boss=new URL(process.env.BOSS_DATABASE_URL);
  if (boss.hostname!==parsed.hostname || (boss.port || '5432')!==(parsed.port || '5432') || boss.pathname!==parsed.pathname)
    throw Error("Zasebna baza reda nije obuhvaćena resetom. Prvo je sigurno ispraznite i privremeno spojite red na pilot bazu.");
}
const hash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
const pool=new Pool({connectionString:url,max:1});
const client=await pool.connect();
try {
  await client.query("BEGIN");
  const meta=await client.query<{name:string;can_bypass:boolean}>("SELECT current_database() AS name,(rolsuper OR rolbypassrls) AS can_bypass FROM pg_roles WHERE rolname=current_user");
  if(meta.rows[0]?.name!==confirm || !meta.rows[0]?.can_bypass) throw Error("Potrebna je namjenska baza i migracijska rola sa BYPASSRLS.");
  // Never cascade: an unexpected reference from an external schema must abort the reset.
  const tables=await client.query<{name:string}>(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> 'schema_migrations' ORDER BY c.relname`);
  if(!tables.rows.length) throw Error("Nema migrirane šeme; reset je otkazan.");
  const identifiers=tables.rows.map(r=>`public."${r.name.replaceAll('"','""')}"`).join(",");
  // This append-only guard intentionally blocks TRUNCATE, even on empty tables. Temporarily
  // disable only that guard; DDL and re-enabling are transactional. No replica-mode bypass.
  const guard=await client.query<{tgenabled:string}>("SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.project_assignments'::regclass AND tgname='project_assignments_truncate_guard'");
  if(guard.rows[0]?.tgenabled !== 'O') throw Error("Zaštita historije nije u očekivanom stanju.");
  await client.query("ALTER TABLE public.project_assignments DISABLE TRIGGER project_assignments_truncate_guard");
  await client.query(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY`);
  const queue=await client.query<{name:string|null}>("SELECT to_regnamespace('pgboss')::text AS name");
  if(queue.rows[0]?.name) {
    const objects=await client.query<{name:string}>("SELECT tablename AS name FROM pg_tables WHERE schemaname='pgboss' AND tablename=ANY($1)",[['job','archive','schedule','subscription']]);
    if(objects.rows.length !== 4) throw Error("Nepoznata pgboss šema; reset je otkazan radi sigurnosti.");
    // Keep queue/version metadata, but purge all old payloads and tenant schedules; worker
    // recreates its global schedules after restart. No CASCADE to other schemas.
    await client.query("TRUNCATE TABLE pgboss.job,pgboss.archive,pgboss.schedule,pgboss.subscription");
  }
  await client.query("ALTER TABLE public.project_assignments ENABLE TRIGGER project_assignments_truncate_guard");
  const company="cmp_pilot", owner="usr_pilot_owner";
  await client.query("INSERT INTO public.companies(id,name,slug,city,timezone,currency,night_from,night_to) VALUES($1,'Gradix Niskogradnja d.o.o. Zenica','gradix-pilot','Zenica','Europe/Sarajevo','BAM','22:00','06:00')",[company]);
  await client.query("SELECT set_config('app.company_id',$1,true)",[company]);
  const people=[
    ["owner","vlasnik","OWNER","Vlasnik"], ["pm","voditelj","PROJECT_MANAGER","Voditelj"],
    ["supervisor","sef","SITE_SUPERVISOR","Šef"], ["accountant","racunovodja","ACCOUNTANT","Računovođa"],
    ["mechanic","mehanicar","MECHANIC","Mehaničar"], ["worker","radnik","WORKER","Radnik"],
  ];
  for(const [id,email,role,first] of people) {
    const user=`usr_pilot_${id}`;
    await client.query("INSERT INTO public.users(id,email,password_hash,first_name,last_name,must_change_password,must_enroll_2fa) VALUES($1,$2,$3,$4,'Pilot',false,$5)",[user,`${email}@pilot.test`,hash,first,role==='OWNER'||role==='ACCOUNTANT']);
    await client.query("INSERT INTO public.memberships(id,user_id,company_id,roles,scope) VALUES($1,$2,$3,ARRAY[$4::\"Role\"],$5)",[`mem_pilot_${id}`,user,company,role,role==='WORKER'?'SELF':'COMPANY']);
    await client.query("INSERT INTO public.workers(id,company_id,first_name,last_name,user_id,hired_at) VALUES($1,$2,$3,'Pilot',$4,'2020-01-01')",[`wrk_pilot_${id}`,company,first,user]);
  }
  await client.query("SELECT public.seed_cost_categories($1)",[company]);
  const components=[
    ['REDOVNI','Redovni sati','EARNING','HOURS','REGULAR',10,true],['PREKOVREMENI','Prekovremeni sati','EARNING','HOURS','OVERTIME',20,true],
    ['NOCNI','Noćni sati','EARNING','HOURS','NIGHT',30,true],['NEDJELJA','Nedjeljni sati','EARNING','HOURS','SUNDAY',40,true],
    ['PRAZNIK','Praznični sati','EARNING','HOURS','HOLIDAY',50,true],['BOLOVANJE','Bolovanje','EARNING','DAYS','ABSENCE',60,true],
    ['GODISNJI','Godišnji odmor','EARNING','DAYS','ABSENCE',70,true],['NEPLACENO','Neplaćeni dopust','EARNING','DAYS','ABSENCE',75,false],
    ['NEOPRAVDANO','Neopravdani izostanak','EARNING','DAYS','ABSENCE',76,false],['TERENSKI','Terenski dodatak','EARNING','DAYS','FIELD_ALLOWANCE',80,true],
    ['AKONTACIJA','Akontacija','DEDUCTION','FIXED','ADVANCE',90,false],['POZAJMICA','Pozajmica','DEDUCTION','FIXED','LOAN',100,false],['OSTALO','Ostalo','EARNING','FIXED','OTHER',110,true],
  ];
  for(const [code,name,kind,basis,category,sort,taxable] of components) await client.query(
    "INSERT INTO public.payroll_components(id,company_id,code,name,kind,basis,category,sort_order,is_taxable,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)",[`pc_pilot_${code}`,company,code,name,kind,basis,category,sort,taxable,owner]);
  for(const [code,value,unit] of [['OVERTIME_MULTIPLIER','1.50','MULTIPLIER'],['NIGHT_MULTIPLIER','1.30','MULTIPLIER'],['SUNDAY_MULTIPLIER','1.50','MULTIPLIER'],['HOLIDAY_MULTIPLIER','1.50','MULTIPLIER'],['SICK_PAY_PCT','0.80','MULTIPLIER'],['FIELD_ALLOWANCE_PER_DAY','1500','CENTS']]) await client.query(
    "INSERT INTO public.payroll_parameters(id,company_id,code,value,unit,valid_from,confirmed_by,created_by,note) VALUES($1,$2,$3,$4,$5,'2000-01-01',$6,$6,'PILOT PRIMJER — računovođa mora potvrditi za stvarni obračun')",[`pp_pilot_${code}`,company,code,value,unit,owner]);
  await client.query("INSERT INTO public.check_templates(id,company_id,name,items,created_by) VALUES('ct_pilot',$1,'Opći dnevni pregled',$2::jsonb,$3)",[company,JSON.stringify([{key:'visual',label:'Vizuelni pregled',required:true,critical:false},{key:'brakes',label:'Kočnice i sigurnost',required:true,critical:true}]),owner]);
  await client.query("INSERT INTO public.stock_items(id,company_id,code,name,unit,system_managed,created_by,updated_by) VALUES('stf_pilot',$1,'PILOT-GORIVO','Gorivo','l',true,$2,$2)",[company,owner]);
  await client.query("INSERT INTO public.warehouses(id,company_id,code,name,kind) VALUES('wht_pilot',$1,'CISTERNA','Cisterna','TANK')",[company]);
  await client.query("INSERT INTO public.fuel_tanks(id,company_id,name,capacity_l,warehouse_id,fuel_item_id) VALUES('ftk_pilot',$1,'Cisterna',5000,'wht_pilot','stf_pilot')",[company]);
  await client.query("COMMIT");
  console.log(`Pilot reset završen za bazu ${confirm}; jedna firma, šest korisnika. Lozinka nije ispisana.`);
} catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();await pool.end();}

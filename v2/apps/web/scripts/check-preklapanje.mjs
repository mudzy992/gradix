#!/usr/bin/env node
/**
 * Provjera preklapanja dodjela na OBA mehanizma, u dvije prave baze.
 *
 * Zašto skript a ne (samo) test: mehanizam se bira PRI MIGRACIJI, po tome postoji li `btree_gist`.
 * Jedna baza zato nikad ne može pokazati oba puta — a upravo se tako desilo da je greška
 * (SQLSTATE 23P01 prepoznat kao „nepoznata") prošla lokalno i pala u CI-ju.
 *
 * Skript pravi DVIJE baze i u obje pušta isti test trke:
 *   1. `…_force_triger` — sa `gradix.bez_btree_gist = on` → MORA ostati triger sa
 *      `pg_advisory_xact_lock`, bez ijedne EXCLUDE constraint-e,
 *   2. `…_auto` — bez prekidača → ponašanje kakvo će biti na serveru: `EXCLUDE USING gist` ako je
 *      `btree_gist` instaliran, inače triger.
 *
 * Zašto prekidač a ne dvije mašine: mehanizam se bira po tome POSTOJI li ekstenzija, pa se na
 * serveru SA contrib-om fallback ne bi nikad izvršio — a upravo je fallback bio nepokriven u
 * trenutku kad je greška (SQLSTATE 23P01) prošla lokalno i pala u CI-ju. Prekidač je `ALTER DATABASE`
 * postavka, dakle ne dira ništa izvan tih probnih baza.
 *
 * Pokretanje: `pnpm check-preklapanje` (traži DATABASE_ADMIN_URL; `psql` mora biti u PATH-u jer
 * migracije idu kroz `infra/scripts/db-apply.sh`).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Client } from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("Nedostaje DATABASE_ADMIN_URL (npr. postgresql://postgres:postgres@127.0.0.1:5432/postgres).");
  process.exit(1);
}

/** Repo korijen (skript je u `apps/web/scripts`). */
const root = join(import.meta.dirname, "..", "..", "..");
const baza = (ime) => `gradix_provjera_${ime}`;
const url = (ime) => {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${baza(ime)}`;
  return parsed.toString();
};
/** Isti server, ali kao aplikacijska rola (migracije rade pod adminom, testovi pod app rolom). */
const appUrl = (ime) => (process.env.DATABASE_URL_APP ?? url(ime)).replace(/\/[^/]+$/, `/${baza(ime)}`);

async function psql(sql, database = "postgres") {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${database}`;
  const client = new Client({ connectionString: parsed.toString() });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** Jedan prolaz: nova baza (+ opcioni prekidač), migracije, pa test trke. */
async function probaj(ime, prinudnoBezGist = false) {
  await psql(`DROP DATABASE IF EXISTS ${baza(ime)}`);
  await psql(`CREATE DATABASE ${baza(ime)}`);
  if (prinudnoBezGist) {
    await psql(`ALTER DATABASE ${baza(ime)} SET gradix.bez_btree_gist = 'on'`);
  }

  const migracije = run("bash", ["infra/scripts/db-apply.sh"], {
    DATABASE_URL: url(ime),
    DATABASE_ADMIN_URL: url(ime),
  });
  if (migracije.code !== 0) {
    return { ok: false, razlog: `migracije pale:\n${migracije.out.slice(-1500)}` };
  }

  const stanje = await psql(
    `SELECT
       (SELECT count(*) FROM pg_constraint WHERE conrelid = 'project_assignments'::regclass AND contype = 'x') AS iskljucujuci,
       (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'project_assignments'::regclass AND NOT tgisinternal) AS trigera`,
    baza(ime),
  );
  const iskljucujuci = Number(stanje.rows[0].iskljucujuci);
  const trigera = Number(stanje.rows[0].trigera);
  const mehanizam = iskljucujuci === 2 && trigera === 0
    ? "EXCLUDE USING gist"
    : trigera === 1 && iskljucujuci === 0
      ? "triger + pg_advisory_xact_lock"
      : `NEISPRAVNO (constraints=${iskljucujuci}, triggers=${trigera})`;

  const test = run(
    "npx",
    ["vitest", "run", "src/server/assignments.race.integration.test.ts"],
    {
      DATABASE_URL: appUrl(ime),
      DATABASE_ADMIN_URL: url(ime),
      AUTH_SECRET: process.env.AUTH_SECRET ?? "lokalni-razvoj-secret-min-32-znaka-123456",
    },
  );

  return {
    ok: test.code === 0 && !mehanizam.startsWith("NEISPRAVNO"),
    mehanizam,
    razlog: test.code === 0 ? null : test.out.slice(-2500),
  };
}

const imaGist = await psql("SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist'");
const gistDostupan = imaGist.rowCount === 1;

const rezultati = [];

// 1) Fallback put — prinudno, da se izvrši i na serveru koji IMA btree_gist.
rezultati.push({
  ime: "force_triger",
  ocekivano: "triger + pg_advisory_xact_lock",
  ...(await probaj("force_triger", true)),
});

// 2) Kako će stvarno biti na ovom serveru.
rezultati.push({
  ime: "auto",
  ocekivano: gistDostupan ? "EXCLUDE USING gist" : "triger + pg_advisory_xact_lock",
  ...(await probaj("auto")),
});

let sveOk = true;
for (const rezultat of rezultati) {
  const saglasno = rezultat.mehanizam === rezultat.ocekivano;
  const prolaz = rezultat.ok && saglasno && !rezultat.preskoceno;
  if (!prolaz) sveOk = false;
  const oznaka = rezultat.preskoceno ? "PRESKOČENO" : prolaz ? "OK" : "PAD";
  console.log(`${oznaka}  ${rezultat.ime}: mehanizam = ${rezultat.mehanizam} (očekivano ${rezultat.ocekivano})`);
  if (rezultat.razlog) console.log(`      ${rezultat.razlog.split("\n").slice(-6).join("\n      ")}`);
}

process.exit(sveOk ? 0 : 1);

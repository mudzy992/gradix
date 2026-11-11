/**
 * Seed za razvoj i demo. Dvije firme namjerno: izolacija se mora moći pokazati,
 * ne samo tvrditi. Podaci su realistični (niskogradnja), ne "Test 1".
 *
 * Pokretanje: DATABASE_ADMIN_URL=... SEED_PASSWORD=... pnpm --filter @gradix/web exec tsx scripts/seed.ts
 * Idempotentno: ponovni seed ne pravi duplikate.
 */
import { Pool } from "pg";
import argon2 from "argon2";
import { companyId, withCompany } from "@gradix/db";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const seedPassword = process.env.SEED_PASSWORD;
if (!adminUrl) throw new Error("Potreban DATABASE_ADMIN_URL");
if (!seedPassword) throw new Error("Potreban SEED_PASSWORD");
if (seedPassword.length < 10) throw new Error("SEED_PASSWORD mora imati najmanje 10 znakova");

const pool = new Pool({ connectionString: adminUrl });

const hash = await argon2.hash(seedPassword, {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

type SeedUser = { id: string; email: string; first: string; last: string; role: string; companyId: string };

const companies = [
  { id: "cmp_demo", name: "Niskogradnja Demo d.o.o.", slug: "niskogradnja-demo" },
  { id: "cmp_druga", name: "Druga Firma d.o.o.", slug: "druga-firma" },
];

const users: SeedUser[] = [
  { id: "usr_vlasnik", email: "vlasnik@demo.ba", first: "Emir", last: "Hadžić", role: "OWNER", companyId: "cmp_demo" },
  { id: "usr_ured", email: "ured@demo.ba", first: "Amina", last: "Karić", role: "ADMIN", companyId: "cmp_demo" },
  { id: "usr_sef", email: "sef@demo.ba", first: "Mario", last: "Perić", role: "SITE_SUPERVISOR", companyId: "cmp_demo" },
  { id: "usr_radnik", email: "radnik@demo.ba", first: "Amar", last: "Hadžić", role: "WORKER", companyId: "cmp_demo" },
  { id: "usr_stranac", email: "vlasnik@druga.test", first: "Nikola", last: "Jović", role: "OWNER", companyId: "cmp_druga" },
];

const machines = [
  { id: "mch_bager", companyId: "cmp_demo", code: "BAG-01", name: "Bager CAT 320", category: "EXCAVATOR" },
  { id: "mch_valjak", companyId: "cmp_demo", code: "VAL-01", name: "Valjak Bomag BW 213", category: "ROLLER" },
  { id: "mch_kamion", companyId: "cmp_demo", code: "KAM-01", name: "Kamion MAN TGS kiper", category: "TRUCK" },
  { id: "mch_tudji", companyId: "cmp_druga", code: "BAG-77", name: "Bager druge firme", category: "EXCAVATOR" },
];

/**
 * R3: projekti i tim. Namjerno JEDAN aktivan i jedan završen — lista mora pokazati oba stanja, a
 * filter po stanju nešto da suzi.
 */
const projects = [
  {
    id: "prj_dionica",
    companyId: "cmp_demo",
    code: "P-01/2026",
    name: "Dionica Visoko–Kiseljak, km 12+400",
    status: "ACTIVE",
    place: "Visoko",
    address: "Magistralni put M5, km 12+400",
    startsOn: "2026-03-02",
    endsOn: "2026-12-15",
  },
  {
    id: "prj_most",
    companyId: "cmp_demo",
    code: "P-02/2025",
    name: "Rekonstrukcija mosta u Kaknju",
    status: "FINISHED",
    place: "Kakanj",
    address: "Most na Bosni, Kakanj",
    startsOn: "2025-04-01",
    endsOn: "2025-11-20",
  },
];

/**
 * Tim na projektu. Radnici nastaju iz dodjele (prvi seed mašina i naloga); ovdje je samo veza,
 * da demo ima „3 · 2“ u listi projekata i da se `PROJECTS` opseg ima na čemu pokazati.
 */
const assignments = [
  { id: "pas_1", projectId: "prj_dionica", workerId: "wrk_demo_amar", from: "2026-03-02" },
  { id: "pas_2", projectId: "prj_dionica", workerId: "wrk_demo_mario", from: "2026-04-01" },
  { id: "pas_3", projectId: "prj_dionica", workerId: "wrk_demo_nedim", from: "2026-05-15" },
  { id: "pas_4", projectId: "prj_dionica", machineId: "mch_bager", from: "2026-03-02" },
  { id: "pas_5", projectId: "prj_dionica", machineId: "mch_kamion", from: "2026-03-16" },
  { id: "pas_6", projectId: "prj_dionica", workerId: "wrk_demo_selmir", from: "2026-06-01" },
  { id: "pas_7", projectId: "prj_dionica", workerId: "wrk_demo_haris", from: "2026-06-01" },
];

/**
 * userId veza je OBAVEZNA za demo tokove: bez nje server šefa ne prepoznaje u R3 opsegu
 * (roster traži workers.user_id = prijavljeni korisnik) i Grupa je uvijek prazna, a radnik
 * se ne može prijaviti za Moj dan. Regresija uhvaćena na telefonu 2026-11-07.
 */
const workers = [
  { id: "wrk_demo_amar", first: "Amar", last: "Hadžić", job: "Rukovalac bagerom", hired: "2023-02-01", userId: "usr_radnik" },
  { id: "wrk_demo_mario", first: "Mario", last: "Perić", job: "Vozač kipera", hired: "2024-09-15", userId: "usr_sef" },
  { id: "wrk_demo_nedim", first: "Nedim", last: "Softić", job: "Radnik na iskopu", hired: "2025-01-20" },
  { id: "wrk_demo_selmir", first: "Selmir", last: "Begić", job: "Rukovalac valjkom", hired: "2024-03-11" },
  { id: "wrk_demo_haris", first: "Haris", last: "Kovačević", job: "Radnik na asfaltiranju", hired: "2025-05-05" },
];

/**
 * Bitno: `memberships` i `machines` su tenant tabele sa FORCE RLS, pa se seed podaci pišu
 * isključivo kroz `withCompany`, uključujući kad migrator posjeduje te tabele. `companies` i
 * početni `users` se održavaju kroz DATABASE_ADMIN_URL; company scope se postavlja i za registry
 * insert da SECURITY DEFINER triggeri za RLS-zaštićene kategorije/tipove dobiju tenant kontekst.
 * Runtime user izmjene idu kroz pregledane invite/password RLS politike.
 */
try {
  for (const company of companies) {
    await withCompany(pool, companyId(company.id), async (client) => {
      await client.query(
        `INSERT INTO companies (id, name, slug) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [company.id, company.name, company.slug],
      );
    });
  }

  for (const user of users) {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, $2, $3, $4, $5, false)
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, email = EXCLUDED.email`,
      [user.id, user.email, hash, user.first, user.last],
    );
    await withCompany(pool, companyId(user.companyId), async (client) => {
      // `ON CONFLICT DO UPDATE` traži da Postgres vidi postojeći red — a RLS ga krije
      // čim se promijeni `id`/`company_id`. Zato je putanja: probaj UPDATE, pa INSERT.
      const updated = await client.query(
        "UPDATE memberships SET roles = ARRAY[$3]::\"Role\"[], scope = 'COMPANY' WHERE user_id = $1 AND company_id = $2",
        [user.id, user.companyId, user.role],
      );
      if (updated.rowCount === 0) {
        await client.query(
          "INSERT INTO memberships (id, user_id, company_id, roles, scope) VALUES ($1, $2, $3, ARRAY[$4]::\"Role\"[], 'COMPANY')",
          [`mem_${user.id}`, user.id, user.companyId, user.role],
        );
      }
    });
  }

  for (const machine of machines) {
    await withCompany(pool, companyId(machine.companyId), async (client) => {
      // Kategorija i u `UPDATE`-u: seed mora vratiti demo u stanje koje opisuje, i kad su
      // mašine već postojale (poslije migracije koja ih je stavila u „Ostalo“).
      const updated = await client.query(
        "UPDATE machines SET code = $2, name = $3, category_id = $4 || '_cat_' || lower($5), meter = COALESCE((SELECT meter FROM equipment_categories WHERE id = $4 || '_cat_' || lower($5)), meter) WHERE id = $1",
        [machine.id, machine.code, machine.name, machine.companyId, machine.category],
      );
      if (updated.rowCount === 0) {
        await client.query(
          "INSERT INTO machines (id, company_id, code, name, category_id) VALUES ($1, $2, $3, $4, $2 || '_cat_' || lower($5))",
          [machine.id, machine.companyId, machine.code, machine.name, machine.category],
        );
      }
    });
  }

  for (const worker of workers) {
    await withCompany(pool, companyId("cmp_demo"), async (client) => {
      const updated = await client.query(
        "UPDATE workers SET first_name = $2, last_name = $3, job_title = $4, user_id = $5 WHERE id = $1",
        [worker.id, worker.first, worker.last, worker.job, "userId" in worker ? worker.userId : null],
      );
      if (updated.rowCount === 0) {
        await client.query(
          `INSERT INTO workers (id, company_id, first_name, last_name, job_title, hired_at, user_id)
           VALUES ($1, 'cmp_demo', $2, $3, $4, $5, $6)`,
          [worker.id, worker.first, worker.last, worker.job, worker.hired, "userId" in worker ? worker.userId : null],
        );
      }
    });
  }

  for (const project of projects) {
    await withCompany(pool, companyId(project.companyId), async (client) => {
      const updated = await client.query(
        `UPDATE projects SET code = $2, name = $3, status = $4, site_place = $5, site_address = $6,
                             starts_on = $7, ends_on = $8
          WHERE id = $1`,
        [
          project.id,
          project.code,
          project.name,
          project.status,
          project.place,
          project.address,
          project.startsOn,
          project.endsOn,
        ],
      );
      if (updated.rowCount === 0) {
        await client.query(
          `INSERT INTO projects (id, company_id, code, name, status, site_place, site_address, starts_on, ends_on)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            project.id,
            project.companyId,
            project.code,
            project.name,
            project.status,
            project.place,
            project.address,
            project.startsOn,
            project.endsOn,
          ],
        );
      }
    });
  }

  for (const assignment of assignments) {
    await withCompany(pool, companyId("cmp_demo"), async (client) => {
      // Triger brani preklapanje, a `ON CONFLICT` ne postoji za ovaj oblik — zato „probaj, pa
      // upiši", isto kao kod mašina i članstava.
      const exists = await client.query("SELECT 1 FROM project_assignments WHERE id = $1", [assignment.id]);
      if (exists.rowCount === 0) {
        await client.query(
          `INSERT INTO project_assignments (id, company_id, project_id, worker_id, machine_id, from_date)
           VALUES ($1, 'cmp_demo', $2, $3, $4, $5)`,
          [
            assignment.id,
            assignment.projectId,
            "workerId" in assignment ? assignment.workerId : null,
            "machineId" in assignment ? assignment.machineId : null,
            assignment.from,
          ],
        );
      }
    });
  }

  // R4a-2 demo sukobi: preklopljen unos radnika (telefon) i šefa (server),
  // jedan sa odstupanjem sata telefona, jedan stariji od praga (3 dana).
  // SEED_DEMO ponašanje se ne mijenja — ovo je običan idempotentan demo podatak.
  await withCompany(pool, companyId("cmp_demo"), async (client) => {
    const demoConflicts = [
      { id: "cnf_demo_1", day: "2026-11-05", entry: "we_demo_srv_1", local: "demo-tel-1", ageDays: 1, skew: null as number | null,
        server: ["07:30", "15:30"], received: ["08:00", "16:00"] },
      { id: "cnf_demo_2", day: "2026-11-04", entry: "we_demo_srv_2", local: "demo-tel-2", ageDays: 1, skew: 6,
        server: ["07:00", "15:00"], received: ["07:06", "15:06"] },
      { id: "cnf_demo_3", day: "2026-11-02", entry: "we_demo_srv_3", local: "demo-tel-3", ageDays: 5, skew: null,
        server: ["07:30", "15:30"], received: ["08:15", "16:15"] },
    ];
    for (const c of demoConflicts) {
      await client.query(
        `INSERT INTO workdays (id, company_id, worker_id, work_date, status, created_by, updated_by)
         VALUES ($1, 'cmp_demo', 'wrk_demo_amar', $2::date, 'DRAFT', 'usr_sef', 'usr_sef')
         ON CONFLICT DO NOTHING`,
        [`wd_demo_${c.id}`, c.day],
      );
      await client.query(
        `INSERT INTO work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, machine_id, created_by, updated_by)
         VALUES ($1, 'cmp_demo', $2, 'wrk_demo_amar', 'WORK',
                 ($3 || 'T' || $4 || ':00+01:00')::timestamptz, ($3 || 'T' || $5 || ':00+01:00')::timestamptz,
                 'KNOWN_END', 'prj_dionica', 'mch_bager', 'usr_sef', 'usr_sef')
         ON CONFLICT (company_id, id) DO NOTHING`,
        [c.entry, `wd_demo_${c.id}`, c.day, c.server[0], c.server[1]],
      );
      await client.query(
        `INSERT INTO sync_conflicts
           (id, company_id, actor_id, local_id, work_entry_id, received_payload, payload_hash, server_version, created_at)
         VALUES ($1, 'cmp_demo', 'usr_radnik', $2, $3, $4::jsonb, $5, 1, clock_timestamp() - make_interval(days => $6))
         -- Demo fikstura se pri ponovnom seedu VRAĆA na OPEN (razriješeni demo
         -- sukob bi inače potrošio seed: E2E razrješenja rješava jedan po
         -- jedan i četvrto uzastopno pokretanje na istoj bazi nema šta
         -- otvoriti — izmjereno mjerenjem stabilnosti, R4a-2/A).
         ON CONFLICT (company_id, actor_id, local_id) DO UPDATE SET
           status = 'OPEN', resolved_by = NULL, resolved_at = NULL,
           resolution_reason = NULL, resolution_kind = NULL,
           internal_note = NULL, resolved_by_party = false,
           resolution_key = NULL`,
        [c.id, c.local, c.entry, JSON.stringify({
          kind: "WORK",
          startedAt: `${c.day}T${c.received[0]}:00+01:00`,
          endedAt: `${c.day}T${c.received[1]}:00+01:00`,
          endState: "KNOWN_END",
          projectId: "prj_dionica",
          machineId: "mch_bager",
          note: null,
          ...(c.skew !== null ? { deviceClockSkewMinutes: c.skew } : {}),
        }), "a".repeat(64), c.ageDays],
      );
    }
  });

  console.log(
    `Seed gotov: ${companies.length} firme, ${users.length} korisnika, ${machines.length} mašina, ` +
      `${projects.length} projekta, ${assignments.length} dodjela.`,
  );
} catch (error) {
  // `withCompany` sam radi ROLLBACK svoje transakcije; ovdje nema otvorene transakcije.
  console.error("Seed nije uspio:", error);
  throw error;
} finally {
  await pool.end();
}

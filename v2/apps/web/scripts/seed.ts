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
];

const workers = [
  { id: "wrk_demo_amar", first: "Amar", last: "Hadžić", job: "Rukovalac bagerom", hired: "2023-02-01" },
  { id: "wrk_demo_mario", first: "Mario", last: "Perić", job: "Vozač kipera", hired: "2024-09-15" },
  { id: "wrk_demo_nedim", first: "Nedim", last: "Softić", job: "Radnik na iskopu", hired: "2025-01-20" },
];

/**
 * Bitno: `memberships` i `machines` su tenant tabele sa FORCE RLS, pa se pišu isključivo
 * kroz `withCompany`. Kad je aplikacijska rola ujedno vlasnik šeme (Coolify/model B),
 * RLS važi i za ovu konekciju — seed bez scope-a bi pao na „new row violates RLS“.
 * `companies` i `users` su globalni, njih pišemo direktno.
 */
try {
  for (const company of companies) {
    await pool.query(
      `INSERT INTO companies (id, name, slug) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [company.id, company.name, company.slug],
    );
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
        "UPDATE workers SET first_name = $2, last_name = $3, job_title = $4 WHERE id = $1",
        [worker.id, worker.first, worker.last, worker.job],
      );
      if (updated.rowCount === 0) {
        await client.query(
          `INSERT INTO workers (id, company_id, first_name, last_name, job_title, hired_at)
           VALUES ($1, 'cmp_demo', $2, $3, $4, $5)`,
          [worker.id, worker.first, worker.last, worker.job, worker.hired],
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

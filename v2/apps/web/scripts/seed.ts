/**
 * Seed za razvoj i demo. Dvije firme namjerno: izolacija se mora moći pokazati,
 * ne samo tvrditi. Podaci su realistični (niskogradnja), ne "Test 1".
 *
 * Pokretanje: DATABASE_ADMIN_URL=... SEED_PASSWORD=... pnpm --filter @gradix/web exec tsx scripts/seed.ts
 * Idempotentno: ponovni seed ne pravi duplikate.
 */
import { Pool } from "pg";
import argon2 from "argon2";

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
  { id: "usr_stranac", email: "vlasnik@druga.ba", first: "Nikola", last: "Jović", role: "OWNER", companyId: "cmp_druga" },
];

const machines = [
  { id: "mch_bager", companyId: "cmp_demo", code: "BAG-01", name: "Bager CAT 320" },
  { id: "mch_valjak", companyId: "cmp_demo", code: "VAL-01", name: "Valjak Bomag BW 213" },
  { id: "mch_kamion", companyId: "cmp_demo", code: "KAM-01", name: "Kamion MAN TGS kiper" },
  { id: "mch_tudji", companyId: "cmp_druga", code: "BAG-77", name: "Bager druge firme" },
];

await pool.query("BEGIN");
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
    await pool.query(
      `INSERT INTO memberships (id, user_id, company_id, roles) VALUES ($1, $2, $3, ARRAY[$4]::"Role"[])
       ON CONFLICT (user_id, company_id) DO UPDATE SET roles = EXCLUDED.roles`,
      [`mem_${user.id}`, user.id, user.companyId, user.role],
    );
  }

  for (const machine of machines) {
    await pool.query(
      `INSERT INTO machines (id, company_id, code, name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [machine.id, machine.companyId, machine.code, machine.name],
    );
  }

  await pool.query("COMMIT");
  console.log(`Seed gotov: ${companies.length} firme, ${users.length} korisnika, ${machines.length} mašina.`);
} catch (error) {
  await pool.query("ROLLBACK");
  throw error;
} finally {
  await pool.end();
}

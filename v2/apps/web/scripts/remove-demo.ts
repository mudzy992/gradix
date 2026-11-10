/**
 * Uklanjanje demo firme — eksplicitna, jednokratna administratorska operacija.
 *
 * Sigurnosna pravila (odluka vlasnika):
 *  - radi samo kad REMOVE_DEMO_CONFIRM bude DOSLOVNO slug demo firme ("niskogradnja-demo");
 *    bez toga skripta staje prije bilo kakve izmjene;
 *  - sve ide u JEDNOJ transakciji: ili se obriše sve, ili ništa;
 *  - demo korisnici (@demo.ba) koji pripadaju samo demo firmi brišu se nakon firme.
 *
 * Pokretanje: DATABASE_ADMIN_URL=... REMOVE_DEMO_CONFIRM=niskogradnja-demo \
 *   pnpm --filter @gradix/web exec tsx scripts/remove-demo.ts
 */
import { Pool } from "pg";

const DEMO_SLUG = "niskogradnja-demo";
const adminUrl = process.env.DATABASE_ADMIN_URL;
const confirm = process.env.REMOVE_DEMO_CONFIRM;

if (!adminUrl) throw new Error("Potreban DATABASE_ADMIN_URL");
if (confirm !== DEMO_SLUG) {
  throw new Error(
    `Uklanjanje nije potvrđeno: postavi REMOVE_DEMO_CONFIRM=${DEMO_SLUG} (doslovan slug) da potvrdiš brisanje demo firme. Ništa nije mijenjano.`,
  );
}

const pool = new Pool({ connectionString: adminUrl });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const company = await client.query<{ id: string }>("SELECT id FROM public.companies WHERE slug = $1", [DEMO_SLUG]);
  const companyId = company.rows[0]?.id;
  if (!companyId) {
    await client.query("ROLLBACK");
    console.log(`Demo firma (${DEMO_SLUG}) ne postoji; ništa za ukloniti.`);
  } else {
    // Sve tenant tabele sa company_id kolonom, otkrivene iz kataloga (bez ručne liste koja zastari).
    const tables = await client.query<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'company_id' ORDER BY table_name`,
    );
    // RESTRICT veze unutar tenant skupa rješavaju se ponavljanjem prolaza do stabilnog stanja.
    for (let pass = 0; pass < 10; pass += 1) {
      let remaining = 0;
      for (const { table_name } of tables.rows) {
        await client.query("SAVEPOINT demo_delete");
        try {
          await client.query(`DELETE FROM public."${table_name}" WHERE company_id = $1`, [companyId]);
          await client.query("RELEASE SAVEPOINT demo_delete");
        } catch {
          await client.query("ROLLBACK TO SAVEPOINT demo_delete");
          const count = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM public."${table_name}" WHERE company_id = $1`,
            [companyId],
          );
          remaining += Number(count.rows[0]?.count ?? 0);
        }
      }
      if (remaining === 0) break;
      if (pass === 9) throw new Error("Demo redovi se nisu mogli obrisati ni nakon 10 prolaza; transakcija se poništava.");
    }
    // Korisnici koji su pripadali samo demo firmi (njihove membership/sesije nestaju kaskadno).
    const demoUsers = await client.query<{ id: string }>(
      `SELECT id FROM public.users
        WHERE email LIKE '%@demo.ba'
          AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = users.id AND m.company_id <> $1)`,
      [companyId],
    );
    await client.query("DELETE FROM public.companies WHERE id = $1", [companyId]);
    for (const user of demoUsers.rows) {
      await client.query("DELETE FROM public.users WHERE id = $1", [user.id]);
    }
    await client.query("COMMIT");
    console.log(`Demo firma ${DEMO_SLUG} (${companyId}) i ${demoUsers.rowCount ?? 0} demo korisnika uklonjeni u jednoj transakciji.`);
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}

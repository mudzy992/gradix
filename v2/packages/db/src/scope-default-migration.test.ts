import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Dokaz za R3 završnu migraciju, na PostgreSQL-u i u izolovanoj privremenoj šemi.
 *
 * Migracija mijenja samo DEFAULT; mora ostaviti postojeće COMPANY i SELF članove kakvi jesu,
 * a naredni red bez izbora mora dobiti SELF. Test izvršava stvarnu SQL datoteku, ne kopiju upita.
 * Traži DATABASE_URL (ista aplikacijska rola kojom se provjerava i runtime preflight).
 */
const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;
const migrationSql = readFileSync(
  fileURLToPath(new URL("../prisma/migrations/20261109180000_r3_scope_default_self/migration.sql", import.meta.url)),
  "utf8",
);

describeDb("migracija DEFAULT scope-a na SELF", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });

  afterAll(async () => {
    await pool.end();
  });

  it("ne mijenja postojeće opsege i novi član bez izbora dobija SELF", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TEMP TABLE memberships (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL DEFAULT 'COMPANY'
        );
        CREATE TEMP TABLE invitations (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL DEFAULT 'COMPANY'
        );
        CREATE TEMP TABLE schema_migrations (name TEXT PRIMARY KEY);
        INSERT INTO memberships (id) VALUES ('postojeci_company');
        INSERT INTO memberships (id, scope) VALUES ('postojeci_self', 'SELF');
        INSERT INTO invitations (id) VALUES ('postojeca_pozivnica');
      `);

      await client.query(migrationSql);

      const existing = await client.query<{ id: string; scope: string }>(
        "SELECT id, scope FROM memberships ORDER BY id",
      );
      expect(existing.rows).toEqual([
        { id: "postojeci_company", scope: "COMPANY" },
        { id: "postojeci_self", scope: "SELF" },
      ]);

      const newMember = await client.query<{ scope: string }>(
        "INSERT INTO memberships (id) VALUES ('novi_clan') RETURNING scope",
      );
      expect(newMember.rows[0]?.scope).toBe("SELF");

      const invitation = await client.query<{ scope: string }>(
        "SELECT scope FROM invitations WHERE id = 'postojeca_pozivnica'",
      );
      expect(invitation.rows[0]?.scope).toBe("COMPANY");

      await client.query("SAVEPOINT bez_opsega");
      await expect(client.query("INSERT INTO invitations (id) VALUES ('bez_izbora')")).rejects.toThrow(
        /null value in column .*scope/i,
      );
      await client.query("ROLLBACK TO SAVEPOINT bez_opsega");
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });
});

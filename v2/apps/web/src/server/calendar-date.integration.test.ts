import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { formatPgDate } from "@gradix/domain";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = adminUrl ? describe : describe.skip;

const SAMPLES = ["2024-02-29", "2026-12-31", "2027-01-01", "2026-03-01"] as const;

describeDb("PostgreSQL DATE keeps the calendar day", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });

  afterAll(async () => {
    await admin.end();
  });

  it("node-pg DATE round-trips through formatPgDate", async () => {
    const row = await admin.query<{ d: unknown }>(
      `SELECT unnest($1::date[]) AS d`,
      [SAMPLES],
    );
    expect(row.rows.map((entry) => formatPgDate(entry.d))).toEqual([...SAMPLES]);
  });
});

/**
 * Dio 2d: `scripts/retention-cleanup.ts` — dry-run samo broji, brisanje
 * traži izričitu primjenu. Tehnički redovi bez ličnih podataka: istekle
 * sesije i tokeni pozivnica stariji od roka retencije.
 */
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { retentionCleanup } from "../../scripts/retention-cleanup";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = adminUrl ? describe : describe.skip;

describeDb("retention-cleanup naredba (Dio 2d)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const stamp = Date.now().toString(36);

  afterAll(async () => {
    await admin.query("DELETE FROM public.sessions WHERE id LIKE 'ses_ret_%'");
    await admin.query("DELETE FROM public.invitations WHERE id LIKE 'inv_ret_%'");
    await admin.end();
  });

  it("dry-run broji bez brisanja; primjena briše samo stare redove", async () => {
    await admin.query(
      `INSERT INTO public.sessions (id, company_id, user_id, token_hash, expires_at)
       VALUES ('ses_ret_old_${stamp}', 'cmp_demo', 'usr_vlasnik', 'hash_ret_old_${stamp}', clock_timestamp() - interval '40 days'),
              ('ses_ret_new_${stamp}', 'cmp_demo', 'usr_vlasnik', 'hash_ret_new_${stamp}', clock_timestamp() - interval '10 days')`,
    );
    await admin.query(
      `INSERT INTO public.invitations (id, company_id, email, roles, scope, token_hash, expires_at, created_by)
       VALUES ('inv_ret_old_${stamp}', 'cmp_demo', 'ret@primjer.test', ARRAY['WORKER']::"Role"[], 'COMPANY', 'hash_inv_ret_${stamp}', clock_timestamp() - interval '40 days', 'usr_vlasnik')`,
    );

    const dry = await retentionCleanup(admin, false);
    expect(dry.applied).toBe(false);
    expect(dry.counts.sessions).toBeGreaterThanOrEqual(1);
    expect(dry.counts.invitations).toBeGreaterThanOrEqual(1);
    const stillThere = await admin.query(
      "SELECT 1 FROM public.sessions WHERE id = $1",
      [`ses_ret_old_${stamp}`],
    );
    expect(stillThere.rowCount).toBe(1);

    const applied = await retentionCleanup(admin, true);
    expect(applied.applied).toBe(true);
    const oldGone = await admin.query("SELECT 1 FROM public.sessions WHERE id = $1", [`ses_ret_old_${stamp}`]);
    expect(oldGone.rowCount).toBe(0);
    const newKept = await admin.query("SELECT 1 FROM public.sessions WHERE id = $1", [`ses_ret_new_${stamp}`]);
    expect(newKept.rowCount).toBe(1);
  });
});

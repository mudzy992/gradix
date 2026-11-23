import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { TenderActor } from "./tender-service";

export type TenderWorld = {
  run: string;
  companyA: string;
  companyB: string;
  partnerA: string;
  owner: TenderActor;
  accountant: TenderActor;
  worker: TenderActor;
  otherCompany: TenderActor;
  seed: (admin: Pool) => Promise<void>;
  teardown: (admin: Pool) => Promise<void>;
};

export function createTenderWorld(): TenderWorld {
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const companyA = `cmp_tnd_a_${run}`;
  const companyB = `cmp_tnd_b_${run}`;
  const userA = `usr_tnd_a_${run}`;
  const partnerA = `ptr_tnd_a_${run}`;
  const companies = [companyA, companyB];
  const owner: TenderActor = { userId: userA, companyId: companyA, roles: ["OWNER"] };
  const accountant: TenderActor = { userId: userA, companyId: companyA, roles: ["ACCOUNTANT"] };
  const worker: TenderActor = { userId: userA, companyId: companyA, roles: ["WORKER"] };
  const otherCompany: TenderActor = { userId: userA, companyId: companyB, roles: ["OWNER"] };
  return {
    run,
    companyA,
    companyB,
    partnerA,
    owner,
    accountant,
    worker,
    otherCompany,
    async seed(admin) {
      await admin.query(
        `INSERT INTO public.companies (id, name, slug) VALUES ($1, 'Tender A', $3), ($2, 'Tender B', $4)`,
        [companyA, companyB, `tnd-a-${run}`, `tnd-b-${run}`],
      );
      await admin.query(
        `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
         VALUES ($1, $2, 'test-hash', 'Tender', 'Owner', false)`,
        [userA, `tnd-${run}@test.example`],
      );
      await admin.query(
        `INSERT INTO public.partners (id, company_id, code, name, kind) VALUES ($1, $2, $3, 'Klijent', 'CLIENT')`,
        [partnerA, companyA, `K-${run}`],
      );
      const seeded = await admin.query(
        `SELECT id FROM public.obligation_types WHERE company_id = $1 AND id = $2`,
        [companyA, `${companyA}_obt_tender_docs`],
      );
      if (seeded.rowCount !== 1) {
        throw new Error("company seed did not create TENDER_DOCS");
      }
    },
    async teardown(admin) {
      await admin.query(`DELETE FROM public.tender_attachments WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.obligations WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.tenders WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.projects WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.audit_events WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.partners WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.obligation_types WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.users WHERE id = $1`, [userA]);
      await admin.query(`DELETE FROM public.companies WHERE id = ANY($1)`, [companies]);
    },
  };
}

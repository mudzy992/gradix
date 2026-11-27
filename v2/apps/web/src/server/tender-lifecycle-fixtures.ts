import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { listTenderChecklist, patchTenderChecklistItem, seedTenderChecklist } from "./tender-checklist-service";
import { putTenderOutcome } from "./tender-outcome-service";
import { createTender, decideTenderParticipation, patchTender, type TenderActor } from "./tender-service";

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
  const owner: TenderActor = { userId: userA, companyId: companyA, roles: ["OWNER"], scope: "COMPANY", projectIds: null };
  const accountant: TenderActor = { userId: userA, companyId: companyA, roles: ["ACCOUNTANT"], scope: "COMPANY", projectIds: null };
  const worker: TenderActor = { userId: userA, companyId: companyA, roles: ["WORKER"], scope: "SELF", projectIds: [] };
  const otherCompany: TenderActor = { userId: userA, companyId: companyB, roles: ["OWNER"], scope: "COMPANY", projectIds: null };
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
      /* Svaki prilog firme, ne samo tenderski: konverzija pravi i `PROJECT` veze na isti
         `object_key`, a `attachments.created_by` je RESTRICT prema `users` — bez ovog reda
         teardown puca na brisanju korisnika. */
      await admin.query(`DELETE FROM public.attachments WHERE company_id = ANY($1)`, [companies]);
      /* Šabloni kontrolne liste nose `created_by` RESTRICT — brišu se prije korisnika. */
      await admin.query(`DELETE FROM public.tender_checklist_templates WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.tender_checklist_items WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.obligations WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.tenders WHERE company_id = ANY($1)`, [companies]);
      /* Konverzija pravi projekat sa fazama, predmjerom i dodjelama — sve to nosi RESTRICT
         prema `projects`, pa teardown ide od najdubljeg prema projektu. */
      await admin.query(
        `DELETE FROM public.project_phases WHERE company_id = ANY($1)`,
        [companies],
      );
      await admin.query(
        `DELETE FROM public.project_boq_items WHERE company_id = ANY($1)`,
        [companies],
      );
      await admin.query(
        `DELETE FROM public.project_assignments WHERE company_id = ANY($1)`,
        [companies],
      );
      await admin.query(`DELETE FROM public.projects WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.audit_events WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.partner_roles WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.partners WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.obligation_types WHERE company_id = ANY($1)`, [companies]);
      await admin.query(`DELETE FROM public.users WHERE id = $1`, [userA]);
      await admin.query(`DELETE FROM public.companies WHERE id = ANY($1)`, [companies]);
    },
  };
}

/**
 * Prolazak kroz KAPije do `WON` — jedan put koji testovi zovu umjesto da 6 puta ponavljaju
 * isti niz. Ako se tok promijeni, mijenja se ovdje, a ne u svakom testu.
 *
 * `items` govori koje stavke kontrolne liste ostaju `MISSING` — test kapije tako dobija tender
 * koji NIJE spreman za predaju, bez ručnog kopiranja stanja.
 */
export async function walkToWon(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  options: { leaveMissing?: boolean } = {},
): Promise<{ ok: boolean; step: string; code?: string; message?: string }> {
  const steps: Array<() => Promise<{ outcome: string; code?: string; message?: string }>> = [
    async () => patchTender(pool, actor, tenderId, { status: "GO_NO_GO" }),
    async () => decideTenderParticipation(pool, actor, tenderId, { participate: true, reason: "Idemo" }),
    async () => patchTender(pool, actor, tenderId, {
      status: "PREPARATION",
      deadlineAt: "2027-01-15T12:00:00.000Z",
      questionsDeadlineAt: "2027-01-05T12:00:00.000Z",
    }),
    async () => {
      // Checklista se puni iz šifarnika tek ovdje: `tender_checklist_templates` je tenant podatak
      // i ne postoji prije prvog tendera firme.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.company_id', $1, true)", [actor.companyId]);
        await seedTenderChecklist(client, actor, tenderId);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      const listed = await listTenderChecklist(pool, actor, tenderId);
      if (!("items" in listed)) return { outcome: "NOT_FOUND", message: "checklist" };
      if (options.leaveMissing) return { outcome: "OK" };
      for (const item of listed.items) {
        if (item.guaranteeType) continue;
        await patchTenderChecklistItem(pool, actor, tenderId, item.id, {
          status: "NOT_APPLICABLE",
          note: "Test: nije primjenjivo",
        });
      }
      return { outcome: "OK" };
    },
    async () => patchTender(pool, actor, tenderId, { status: "SUBMITTED" }),
    async () => patchTender(pool, actor, tenderId, { status: "EVALUATION" }),
    async () => putTenderOutcome(pool, actor, tenderId, { result: "WON" }),
    async () => patchTender(pool, actor, tenderId, { status: "WON" }),
  ];

  for (const [index, step] of steps.entries()) {
    const result = await step();
    if (result.outcome !== "OK") {
      return { ok: false, step: `#${index + 1}`, code: result.code, message: result.message };
    }
  }
  return { ok: true, step: "won" };
}

/** Novi tender u `OPPORTUNITY` sa naslovom koji nosi `run` oznaku (jedinstven po testu). */
export async function newTenderId(
  pool: Pool,
  actor: TenderActor,
  partnerId: string,
  title: string,
): Promise<string> {
  const created = await createTender(pool, actor, {
    title,
    partnerId,
    submittedValueAmount: "20.00",
    currencyCode: "BAM",
  });
  if (created.outcome !== "OK" || !created.id) {
    const detail = created.outcome === "OK" ? "" : (created.code ?? created.message ?? "");
    throw new Error(`createTender nije prošao: ${created.outcome} ${detail}`);
  }
  return created.id;
}

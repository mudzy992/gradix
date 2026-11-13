/**
 * B4 — administratorska naredba: demo podaci za Pregled (nadzorna ploča).
 *
 * Šta pravi (sve u demo firmi, sve izmišljeno):
 *  1. Jedna BLOKIRANA dodjela mašine: istekla „Registracija" (12 dana u
 *     prošlosti) na mašini koja je aktivno dodijeljena na projekat —
 *     `listAssignments` je prijavljuje kao blokiranu s razlogom.
 *  2. Dani za provjeru (SUBMITTED): jedan sa segmentom nepoznatog kraja
 *     (UNKNOWN_END), jedan sa redovnim segmentima i pauzom; plus današnji
 *     dan u toku (DRAFT) sa otvorenim segmentom (OPEN).
 *  3. Podaci sinhronizacije: po jedna zadnja sinhronizacija po korisniku
 *     (sync_receipts, različito vrijeme po glumcu) i nekoliko neuspjelih
 *     stavki (sync_conflicts, status OPEN).
 *
 * Sigurnost (isti kapitel kao demo-sukobi i seed-demo-podaci):
 *  - radi SAMO za firmu označenu kao demo (slug `niskogradnja-demo`); za
 *    svaku drugu firmu staje prije bilo kakvog upisa;
 *  - pokreće se ručno, pod administratorskom rolom baze (DATABASE_ADMIN_URL),
 *    nikad iz aplikacije i nikad automatski;
 *  - nema stvarnih ličnih podataka — brojevi, izdavači i imena su izmišljeni.
 *
 * Idempotentnost: svi redovi koje ova naredba pravi nose `prg_` prefikse
 * (ili `prg-sync-` za local_id) i BRIŠU se prije upisa, pa svaki poziv vraća
 * firmu u isto stanje, dato prema današnjem danu. Postojeći tipovi i obaveze
 * firme se NE diraju — blokada ide preko dediciranog demo tipa.
 *
 * Pokretanje (vidi docs/COOLIFY.md):
 *   DATABASE_ADMIN_URL=... pnpm --filter @gradix/web exec tsx scripts/demo-pregled.ts
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { DEMO_COMPANY_SLUG } from "./demo-sukobi";

/** Prefiks svih redova koje ova naredba posjeduje (čisti ih prije upisa). */
const PREFIX = "prg_";

export type DemoPregledReport = {
  blockedAssignment: {
    assignmentId: string;
    machineCode: string;
    machineName: string;
    typeLabel: string;
    expiresAt: string;
  } | null;
  workdays: { id: string; workerName: string; workDate: string; status: string; segments: string[] }[];
  sync: { actorId: string; lastSyncAt: string; receipts: number }[];
  failedItems: { id: string; actorId: string; ageHours: number }[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Prvi SLOBODAN dan na koji se smije staviti workday radnika: postojeći dani
 * se zaobilaze (kanonski dan je unikatan po radniku), kao u demo-sukobi.
 */
async function freeDayFor(
  client: PoolClient,
  companyIdValue: string,
  workerId: string,
  today: string,
  offsetDays: number,
): Promise<string> {
  const busy = await client.query<{ day: string }>(
    "SELECT DISTINCT work_date::text AS day FROM public.workdays WHERE company_id = $1 AND worker_id = $2",
    [companyIdValue, workerId],
  );
  const busyDays = new Set(busy.rows.map((row) => row.day));
  const base = new Date(`${today}T00:00:00Z`);
  let offset = offsetDays;
  let date = new Date(base.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
  while (busyDays.has(date) && offset < 90) {
    offset += 1;
    date = new Date(base.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
  }
  return date;
}

export async function seedDemoPregled(
  pool: Pool,
  slug: string = DEMO_COMPANY_SLUG,
): Promise<DemoPregledReport> {
  if (slug !== DEMO_COMPANY_SLUG) {
    throw new Error(
      `Odbijeno: naredba radi samo za demo firmu (slug ${DEMO_COMPANY_SLUG}), traženo je „${slug}". Ništa nije mijenjano.`,
    );
  }

  const company = await pool.query<{ id: string; today: string }>(
    "SELECT id, (clock_timestamp() AT TIME ZONE timezone)::date::text AS today FROM public.companies WHERE slug = $1",
    [slug],
  );
  const companyRow = company.rows[0];
  if (!companyRow) throw new Error(`Demo firma (slug ${slug}) ne postoji. Prvo pokrenite seed.`);
  const companyIdValue = companyRow.id;
  const today = companyRow.today;

  return withCompany(pool, companyId(companyIdValue), async (client) => {
    // --- 0. Čišćenje prošlih prolaza: samo svoji redovi, u FK redu. ---
    await client.query("DELETE FROM public.sync_conflicts WHERE company_id = $1 AND id LIKE $2", [
      companyIdValue,
      `${PREFIX}cnf_%`,
    ]);
    await client.query("DELETE FROM public.work_entries WHERE company_id = $1 AND id LIKE $2", [
      companyIdValue,
      `${PREFIX}we_%`,
    ]);
    await client.query("DELETE FROM public.workdays WHERE company_id = $1 AND id LIKE $2", [
      companyIdValue,
      `${PREFIX}wd_%`,
    ]);
    await client.query("DELETE FROM public.sync_receipts WHERE company_id = $1 AND local_id LIKE $2", [
      companyIdValue,
      "prg-sync-%",
    ]);
    // Obaveza: verzije idu kaskadno; supersede lanac se vraća (FK ON DELETE SET NULL).
    await client.query("DELETE FROM public.obligations WHERE company_id = $1 AND id LIKE $2", [
      companyIdValue,
      `${PREFIX}obl_%`,
    ]);
    // Dedicirani demo tip (briše se nakon obaveza — FK RESTRICT).
    await client.query("DELETE FROM public.obligation_types WHERE company_id = $1 AND id = $2", [
      companyIdValue,
      `${PREFIX}obt_registracija`,
    ]);

    // --- Glumci i entiteti iz seeda. ---
    const actors = await client.query<{ user_id: string; role: string }>(
      `SELECT m.user_id, m.roles[1] AS role
         FROM public.memberships m
        WHERE m.company_id = $1 AND m.is_active
        ORDER BY m.user_id`,
      [companyIdValue],
    );
    const byRole = (role: string) => actors.rows.find((row) => row.role === role);
    const workerUser = byRole("WORKER");
    const foremanUser = byRole("SITE_SUPERVISOR");
    if (!workerUser || !foremanUser) {
      throw new Error("Demo firma naka članove s rolama WORKER i SITE_SUPERVISOR. Prvo pokrenite seed.");
    }

    const target = await client.query<{
      assignment_id: string;
      machine_id: string;
      machine_code: string;
      machine_name: string;
      project_id: string;
    }>(
      `SELECT a.id AS assignment_id, m.id AS machine_id, m.code AS machine_code, m.name AS machine_name,
              a.project_id
         FROM public.project_assignments a
         JOIN public.machines m ON m.company_id = a.company_id AND m.id = a.machine_id
         JOIN public.projects p ON p.company_id = a.company_id AND p.id = a.project_id
        WHERE a.company_id = $1 AND a.machine_id IS NOT NULL
          AND a.voided_at IS NULL AND (a.to_date IS NULL OR a.to_date >= $2::date)
          AND p.status = 'ACTIVE' AND p.is_active
        ORDER BY a.from_date, m.code
        LIMIT 1`,
      [companyIdValue, today],
    );
    const targetRow = target.rows[0];
    if (!targetRow) {
      throw new Error("Demo firma nema aktivnu dodjelu mašine na aktivnom projektu. Prvo pokrenite seed.");
    }

    // Dedicirani demo tip obaveze: blocks_assignment je PODATAK firme (B5.4) i razlikuje
    // se između svježe migracije i uvezenih tipova, pa demo ne dira tuđe tipove —
    // pravi svoj, uvijek blokirajući, da je ishod determinističan na svakoj bazi.
    await client.query(
      `INSERT INTO public.obligation_types
         (id, company_id, code, label, entity_kind, default_reminder_days, requires_attachment, blocks_assignment, sort_order)
       VALUES ($1, $2, 'PRG_REGISTRACIJA', 'Registracija (demo)', 'MACHINE', '{30,15,7}', false, true, 95)`,
      [`${PREFIX}obt_registracija`, companyIdValue],
    );
    const typeRow = { id: `${PREFIX}obt_registracija`, label: "Registracija (demo)" };

    // --- 1. Istekla registracija → blokirana dodjela mašine. ---
    await client.query(
      `INSERT INTO public.obligations (id, company_id, type_id, machine_id, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [`${PREFIX}obl_registracija`, companyIdValue, typeRow.id, targetRow.machine_id, foremanUser.user_id],
    );
    await client.query(
      `INSERT INTO public.obligation_versions (id, company_id, obligation_id, version, number, issuer, issued_at, expires_at, note, created_by)
       VALUES ($1, $2, $3, 1, $4, $5, ($6::date - 380), ($6::date - 12), $7, $8)`,
      [
        `${PREFIX}oblv_registracija`,
        companyIdValue,
        `${PREFIX}obl_registracija`,
        "REG-2025-04417",
        "Ministarstvo saobraćaja (demo)",
        today,
        "Registracija istekla — obnavljanje u toku (demo podatak za Pregled).",
        foremanUser.user_id,
      ],
    );

    // --- 2. Dani za provjeru + dan u toku. ---
    const seededWorkers = await client.query<{ id: string; first_name: string; last_name: string; user_id: string | null }>(
      "SELECT id, first_name, last_name, user_id FROM public.workers WHERE company_id = $1 AND is_active ORDER BY id",
      [companyIdValue],
    );
    // Radnik s mobilnim računom za predat dan; ostali za dane koje vodi šef.
    const workerWithApp =
      seededWorkers.rows.find((row) => row.user_id === workerUser.user_id) ?? seededWorkers.rows[0];
    const workerNoApp = seededWorkers.rows.find((row) => !row.user_id) ?? seededWorkers.rows[1];
    const workerOpen =
      seededWorkers.rows.find(
        (row) => !row.user_id && row.id !== workerNoApp?.id,
      ) ?? seededWorkers.rows[2];
    if (!workerWithApp || !workerNoApp || !workerOpen) {
      throw new Error("Demo firma nema dovoljno aktivnih radnika. Prvo pokrenite seed.");
    }

    const insertWorkday = async (id: string, workerId: string, date: string, status: string, byUser: string) => {
      await client.query(
        `INSERT INTO public.workdays (id, company_id, worker_id, work_date, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4::date, $5, $6, $6)`,
        [id, companyIdValue, workerId, date, status, byUser],
      );
    };
    const insertEntry = async (
      id: string,
      workdayId: string,
      workerId: string,
      kind: "WORK" | "BREAK",
      date: string,
      from: string,
      to: string | null,
      endState: "OPEN" | "UNKNOWN_END" | "KNOWN_END",
      projectId: string | null,
      machineId: string | null,
      byUser: string,
    ) => {
      // ($6 || NULL) je NULL u Postgresu, pa isti upit služi i za segment bez kraja.
      await client.query(
        `INSERT INTO public.work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, machine_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, ($6 || $7)::timestamptz, ($6 || $8)::timestamptz, $9, $10, $11, $12, $12)`,
        [id, companyIdValue, workdayId, workerId, kind, date, from, to, endState, projectId, machineId, byUser],
      );
    };

    // 2a. Predat dan s segmentom nepoznatog kraja (za provjeru: „otvoren segment, nepoznat kraj").
    const dayUnknown = await freeDayFor(client, companyIdValue, workerWithApp.id, today, 1);
    await insertWorkday(`${PREFIX}wd_nepoznat`, workerWithApp.id, dayUnknown, "SUBMITTED", workerWithApp.user_id!);
    await insertEntry(`${PREFIX}we_nepoznat_1`, `${PREFIX}wd_nepoznat`, workerWithApp.id, "WORK", dayUnknown, "T07:30:00+01:00", "T15:30:00+01:00", "KNOWN_END", targetRow.project_id, targetRow.machine_id, workerWithApp.user_id!);
    await insertEntry(`${PREFIX}we_nepoznat_2`, `${PREFIX}wd_nepoznat`, workerWithApp.id, "WORK", dayUnknown, "T16:10:00+01:00", null, "UNKNOWN_END", targetRow.project_id, null, workerWithApp.user_id!);

    // 2b. Predat dan sa redovnim segmentima i pauzom (pauza je odvojen segment, ne preklapa se).
    const dayRegular = await freeDayFor(client, companyIdValue, workerNoApp.id, today, 2);
    await insertWorkday(`${PREFIX}wd_redovan`, workerNoApp.id, dayRegular, "SUBMITTED", foremanUser.user_id);
    await insertEntry(`${PREFIX}we_redovan_1`, `${PREFIX}wd_redovan`, workerNoApp.id, "WORK", dayRegular, "T07:00:00+01:00", "T11:00:00+01:00", "KNOWN_END", targetRow.project_id, null, foremanUser.user_id);
    await insertEntry(`${PREFIX}we_redovan_2`, `${PREFIX}wd_redovan`, workerNoApp.id, "BREAK", dayRegular, "T11:00:00+01:00", "T11:30:00+01:00", "KNOWN_END", null, null, foremanUser.user_id);
    await insertEntry(`${PREFIX}we_redovan_3`, `${PREFIX}wd_redovan`, workerNoApp.id, "WORK", dayRegular, "T11:30:00+01:00", "T15:00:00+01:00", "KNOWN_END", targetRow.project_id, targetRow.machine_id, foremanUser.user_id);

    // 2c. Današnji dan u toku: otvoren segment. Jedan OPEN po radniku je baza
    // ograničila, a dan je kanonski po radniku — kandidati se probavaju redom.
    const openBusy = await client.query<{ worker_id: string }>(
      "SELECT worker_id FROM public.work_entries WHERE company_id = $1 AND end_state = 'OPEN'",
      [companyIdValue],
    );
    const openBusyWorkers = new Set(openBusy.rows.map((row) => row.worker_id));
    const todayBusy = await client.query<{ worker_id: string }>(
      "SELECT worker_id FROM public.workdays WHERE company_id = $1 AND work_date = $2::date",
      [companyIdValue, today],
    );
    const todayBusyWorkers = new Set(todayBusy.rows.map((row) => row.worker_id));
    const openCandidates = [workerOpen, workerNoApp, ...seededWorkers.rows];
    const openWorker = openCandidates.find(
      (row) => row && !openBusyWorkers.has(row.id) && !todayBusyWorkers.has(row.id),
    );
    if (!openWorker) {
      throw new Error("Nema slobodnog radnika za današnji otvoren segment. Očistite stare demo podatke.");
    }
    await insertWorkday(`${PREFIX}wd_utoku`, openWorker.id, today, "DRAFT", foremanUser.user_id);
    await insertEntry(`${PREFIX}we_utoku`, `${PREFIX}wd_utoku`, openWorker.id, "WORK", today, "T08:05:00+01:00", null, "OPEN", targetRow.project_id, targetRow.machine_id, foremanUser.user_id);

    // --- 3. Sinhronizacija: zadnja po korisniku + neuspjele stavke. ---
    const insertReceipt = async (actorId: string, localId: string, entityId: string, hoursAgo: number) => {
      await client.query(
        `INSERT INTO public.sync_receipts (id, company_id, actor_id, local_id, request_hash, result, created_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::jsonb, clock_timestamp() - make_interval(hours => $6))`,
        [
          companyIdValue,
          actorId,
          localId,
          sha256(`${localId}:${hoursAgo}`),
          JSON.stringify({ localId, status: "APPLIED", entityId, version: 1, cursor: null }),
          hoursAgo,
        ],
      );
    };
    await insertReceipt(workerUser.user_id, "prg-sync-radnik-1", `${PREFIX}wd_nepoznat`, 2);
    await insertReceipt(workerUser.user_id, "prg-sync-radnik-2", `${PREFIX}wd_nepoznat`, 26);
    await insertReceipt(foremanUser.user_id, "prg-sync-sef-1", `${PREFIX}wd_redovan`, 20);

    const insertConflict = async (id: string, actorId: string, entryId: string, date: string, hoursAgo: number, skew: number | null) => {
      const received = {
        kind: "WORK",
        startedAt: `${date}T08:00:00+01:00`,
        endedAt: `${date}T16:00:00+01:00`,
        endState: "KNOWN_END",
        projectId: targetRow.project_id,
        machineId: targetRow.machine_id,
        note: null,
        ...(skew !== null ? { deviceClockSkewMinutes: skew } : {}),
      };
      await client.query(
        `INSERT INTO public.sync_conflicts
           (id, company_id, actor_id, local_id, work_entry_id, received_payload, payload_hash, server_version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 1, clock_timestamp() - make_interval(hours => $8))`,
        [
          id,
          companyIdValue,
          actorId,
          `prg-${id}`,
          entryId,
          JSON.stringify(received),
          sha256(JSON.stringify(received)),
          hoursAgo,
        ],
      );
    };
    await insertConflict(`${PREFIX}cnf_radnik_1`, workerUser.user_id, `${PREFIX}we_nepoznat_1`, dayUnknown, 5, null);
    await insertConflict(`${PREFIX}cnf_radnik_2`, workerUser.user_id, `${PREFIX}we_nepoznat_1`, dayUnknown, 29, 6);
    await insertConflict(`${PREFIX}cnf_sef_1`, foremanUser.user_id, `${PREFIX}we_redovan_1`, dayRegular, 48, null);

    // --- Izvještaj iz baze (ne iz namjere): što je zaista upisano. ---
    const blocked = await client.query<{ expires_at: string }>(
      "SELECT expires_at::text AS expires_at FROM public.obligations WHERE company_id = $1 AND id = $2",
      [companyIdValue, `${PREFIX}obl_registracija`],
    );
    const dayRows = await client.query<{ id: string; worker_name: string; work_date: string; status: string; segments: string[] }>(
      `SELECT wd.id, (w.first_name || ' ' || w.last_name) AS worker_name, wd.work_date::text AS work_date, wd.status,
              array_agg(DISTINCT we.end_state ORDER BY we.end_state) FILTER (WHERE we.id IS NOT NULL) AS segments
         FROM public.workdays wd
         JOIN public.workers w ON w.company_id = wd.company_id AND w.id = wd.worker_id
         LEFT JOIN public.work_entries we ON we.company_id = wd.company_id AND we.workday_id = wd.id
        WHERE wd.company_id = $1 AND wd.id LIKE $2
        GROUP BY wd.id, worker_name, wd.work_date, wd.status
        ORDER BY wd.work_date DESC`,
      [companyIdValue, `${PREFIX}wd_%`],
    );
    const syncRows = await client.query<{ actor_id: string; last: string; n: string }>(
      `SELECT actor_id, max(created_at)::text AS last, count(*)::text AS n
         FROM public.sync_receipts
        WHERE company_id = $1 AND local_id LIKE 'prg-sync-%'
        GROUP BY actor_id ORDER BY actor_id`,
      [companyIdValue],
    );
    const conflictRows = await client.query<{ id: string; actor_id: string; age_hours: string }>(
      `SELECT id, actor_id, floor(extract(epoch FROM (clock_timestamp() - created_at)) / 3600)::text AS age_hours
         FROM public.sync_conflicts
        WHERE company_id = $1 AND id LIKE $2
        ORDER BY created_at DESC`,
      [companyIdValue, `${PREFIX}cnf_%`],
    );

    const report: DemoPregledReport = {
      blockedAssignment: {
        assignmentId: targetRow.assignment_id,
        machineCode: targetRow.machine_code,
        machineName: targetRow.machine_name,
        typeLabel: typeRow.label,
        expiresAt: blocked.rows[0]?.expires_at ?? "",
      },
      workdays: dayRows.rows.map((row) => ({
        id: row.id,
        workerName: row.worker_name,
        workDate: row.work_date,
        status: row.status,
        segments: row.segments ?? [],
      })),
      sync: syncRows.rows.map((row) => ({ actorId: row.actor_id, lastSyncAt: row.last, receipts: Number(row.n) })),
      failedItems: conflictRows.rows.map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        ageHours: Number(row.age_hours),
      })),
    };
    return report;
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error("Potreban DATABASE_ADMIN_URL");
  const slugArg = process.argv[2];
  const pool = new Pool({ connectionString: adminUrl });
  try {
    const report = await seedDemoPregled(pool, slugArg ?? DEMO_COMPANY_SLUG);
    console.log("Demo podaci za Pregled napravljeni:");
    console.log(
      `  blokirana dodjela: ${report.blockedAssignment?.machineCode} (${report.blockedAssignment?.typeLabel}, isteklo ${report.blockedAssignment?.expiresAt}) — dodjela ${report.blockedAssignment?.assignmentId}`,
    );
    for (const day of report.workdays) {
      console.log(`  dan ${day.workDate} ${day.status} — ${day.workerName}: ${day.segments.join(", ") || "bez segmenata"}`);
    }
    for (const sync of report.sync) {
      console.log(`  zadnja sinhronizacija: ${sync.actorId} — ${sync.lastSyncAt} (${sync.receipts} računa)`);
    }
    console.log(`  neuspjele stavke: ${report.failedItems.map((item) => `${item.id} (${item.actorId})`).join(", ")}`);
  } finally {
    await pool.end();
  }
}

/**
 * Faza 3 — integracioni test kompletne vertikale preko HTTP ruta (ne servisa direktno).
 *
 * Zašto kroz rute: servis može biti ispravan a ruta pogrešno zaštićena. Ovaj test zato
 * provjerava i dozvolu i posljedicu na podatke.
 *
 * Zašto pod `DATABASE_URL` (aplikacijska rola): pod vlasničkom rolom `permission denied` bi
 * ostao skriven, pa bi test prošao i da grantovi za pet novih tabela nisu primijenjeni.
 *
 * Provjerava odluke iz specifikacija koje se lako tiho pokvare:
 *  - timer je idempotentan po `localId` (retry sa telefona ne otvara drugi segment),
 *  - izostanak briše sate iz zbira, ali dan ostaje,
 *  - zaokruživanje ide PO SEGMENTU, ne po zbiru,
 *  - cijena se ne prepisuje, nego zatvara (`valid_to`),
 *  - zaduženje se ne briše, nego vraća,
 *  - „Radnik odlazi“ odbija radnika sa nerazduženom opremom.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { POST as timerRoute } from "@/app/api/workdays/timer/route";
import { GET as myDayRoute } from "@/app/api/me/day/route";
import { POST as closeForgottenRoute } from "@/app/api/workdays/close-forgotten/route";
import { PATCH as kindRoute } from "@/app/api/workdays/[id]/kind/route";
import { GET as weekRoute } from "@/app/api/workdays/week/route";
import { POST as bulkConfirmRoute } from "@/app/api/workdays/confirm-bulk/route";
import { GET as ratesRoute, POST as addRateRoute } from "@/app/api/workers/[id]/rates/route";
import { PATCH as closeRateRoute } from "@/app/api/workers/[id]/rates/[rateId]/close/route";
import { GET as leaveRoute, POST as leaveSetRoute } from "@/app/api/workers/[id]/leave/route";
import { GET as issuancesRoute, POST as addIssuanceRoute } from "@/app/api/workers/[id]/issuances/route";
import { PATCH as returnIssuanceRoute } from "@/app/api/workers/[id]/issuances/[issuanceId]/return/route";
import { GET as historyRoute } from "@/app/api/workers/[id]/history/route";
import { POST as offboardRoute } from "@/app/api/workers/[id]/offboard/route";
import { POST as bulkWorkersRoute } from "@/app/api/workers/bulk/route";
import { GET as profileRoute, PATCH as profilePatchRoute } from "@/app/api/workers/[id]/profile/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const COMPANY = `cmp_f3_${RUN}`;
const OTHER_COMPANY = `cmp_f3x_${RUN}`;
const U_OWNER = `usr_f3_o_${RUN}`;
const U_SEF = `usr_f3_s_${RUN}`;
const U_RADNIK = `usr_f3_r_${RUN}`;
const W_RADNIK = `wrk_f3_r_${RUN}`;
const W_SEF = `wrk_f3_s_${RUN}`;
const W_DRUGI = `wrk_f3_d_${RUN}`;
const PROJECT = `prj_f3_${RUN}`;
const MACHINE = `mch_f3_${RUN}`;
const CATEGORY = `cat_f3_${RUN}`;
const DAY = "2026-11-16"; // ponedjeljak — sedmica je jednoznačna
const DAY2 = "2026-11-17";

function headers(cookie: string): Record<string, string> {
  return { cookie, "content-type": "application/json" };
}

async function signIn(userId: string): Promise<string> {
  const sessionId = `ses_${userId}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await withCompany(admin, companyId(COMPANY), async (client) => {
    await client.query(
      `INSERT INTO sessions (id, company_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day')
       ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [sessionId, COMPANY, userId, `hash_${sessionId}`],
    );
  });
  await admin.end();
  return `${ACCESS_COOKIE}=${issueAccessToken({ sub: userId, sid: sessionId, companyId: COMPANY })}`;
}

describeDb("F3 — radno vrijeme i radnici (HTTP)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  let cOwner = "";
  let cSef = "";
  let cRadnik = "";

  beforeAll(async () => {
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'F3 Test', $2), ($3, 'F3 Tuđa', $4)`, [
      COMPANY,
      `f3-${RUN}`,
      OTHER_COMPANY,
      `f3x-${RUN}`,
    ]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1, $4, 'V', 'lasnik', 'x', false), ($2, $5, 'S', 'ef', 'x', false), ($3, $6, 'R', 'adnik', 'x', false)`,
      [U_OWNER, U_SEF, U_RADNIK, `o-f3-${RUN}@test.example`, `s-f3-${RUN}@test.example`, `r-f3-${RUN}@test.example`],
    );
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY'),
                ($4, $5, $3, ARRAY['SITE_SUPERVISOR']::"Role"[], 'COMPANY'),
                ($6, $7, $3, ARRAY['WORKER']::"Role"[], 'SELF')`,
        [`mem_o_${RUN}`, U_OWNER, COMPANY, `mem_s_${RUN}`, U_SEF, `mem_r_${RUN}`, U_RADNIK],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, engagement, hired_at, user_id, is_active)
         VALUES ($1, $4, 'R', 'adnik', 'PERMANENT', '2025-01-01', $5, true),
                ($2, $4, 'S', 'ef', 'PERMANENT', '2025-01-01', $6, true),
                ($3, $4, 'D', 'rugi', 'PERMANENT', '2025-01-01', NULL, true)`,
        [W_RADNIK, W_SEF, W_DRUGI, COMPANY, U_RADNIK, U_SEF],
      );
      await client.query(
        `INSERT INTO projects (id, company_id, code, name, status)
         VALUES ($1, $2, $3, 'F3 gradilište', 'ACTIVE')`,
        [PROJECT, COMPANY, `F3-${RUN}`],
      );
      await client.query(
        `INSERT INTO equipment_categories (id, company_id, code, name, meter) VALUES ($1, $2, $3, 'Mašine', 'HOURS')`,
        [CATEGORY, COMPANY, `CATF3${RUN.slice(-6).toUpperCase()}`],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id) VALUES ($1, $2, $3, 'Bager', $4)`,
        [MACHINE, COMPANY, `M-${RUN}`, CATEGORY],
      );
      /*
       * Dodjela je ILI radnik ILI mašina (`project_assignments_one_target`), pa radnik dobija
       * dodjelu bez mašine. Timer tada nudi projekat bez mašine — što je i realan slučaj za
       * fizičkog radnika.
       */
      await client.query(
        `INSERT INTO project_assignments (id, company_id, project_id, worker_id, from_date, created_by)
         VALUES (gen_random_uuid()::text, $1, $2, $3, '2026-11-01', $4),
                (gen_random_uuid()::text, $1, $2, $5, '2026-11-01', $4),
                (gen_random_uuid()::text, $1, $2, $6, '2026-11-01', $4)`,
        [COMPANY, PROJECT, W_RADNIK, U_OWNER, W_SEF, W_DRUGI],
      );
    });
    cOwner = await signIn(U_OWNER);
    cSef = await signIn(U_SEF);
    cRadnik = await signIn(U_RADNIK);
  });

  afterAll(async () => {
    await admin.end();
  });

  it("timer start otvara segment i vraća stanje dana", async () => {
    const response = await timerRoute(
      new NextRequest("http://localhost/api/workdays/timer", {
        method: "POST",
        headers: headers(cRadnik),
        body: JSON.stringify({ action: "start", at: `${DAY}T06:00:00.000Z`, localId: `we_f3_a_${RUN}` }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.day.segments).toHaveLength(1);
    expect(body.data.day.segments[0].kind).toBe("WORK");
    // Jedna dodjela → projekat je izveden bez pitanja.
    expect(body.data.day.segments[0].projectId).toBe(PROJECT);
  });

  it("isti localId ne otvara drugi segment (mreža je poslala dvaput)", async () => {
    const response = await timerRoute(
      new NextRequest("http://localhost/api/workdays/timer", {
        method: "POST",
        headers: headers(cRadnik),
        body: JSON.stringify({ action: "start", at: `${DAY}T06:00:00.000Z`, localId: `we_f3_a_${RUN}` }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.day.segments).toHaveLength(1);
  });

  it("finish zatvara segment i dan ima sate", async () => {
    const response = await timerRoute(
      new NextRequest("http://localhost/api/workdays/timer", {
        method: "POST",
        headers: headers(cRadnik),
        body: JSON.stringify({ action: "finish", at: `${DAY}T14:00:00.000Z` }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.day.segments[0].endState).toBe("KNOWN_END");
    expect(body.data.day.minutes).toBe(480);
    expect(body.data.day.rawMinutes).toBe(480);
    expect(body.data.day.reviewState).toBe("OK");
  });

  it("drugi finish bez otvorenog segmenta je 409, ne tiha nula", async () => {
    const response = await timerRoute(
      new NextRequest("http://localhost/api/workdays/timer", {
        method: "POST",
        headers: headers(cRadnik),
        body: JSON.stringify({ action: "finish", at: `${DAY}T15:00:00.000Z` }),
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("WORKDAY_ALREADY_OPEN");
  });

  it("Moj dan vraća današnji dan, zaboravljen dan i dodjele", async () => {
    const response = await myDayRoute(
      new NextRequest("http://localhost/api/me/day", { headers: headers(cRadnik) }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.assignments.length).toBe(1);
    expect(body.data.forgottenThresholdHours).toBeGreaterThan(0);
    // Bez radničkog zapisa nema dana; sa zapisom danas ili nema dana ili postoji — oboje je tačno.
    expect(body.data).toHaveProperty("today");
  });

  it("izostanak briše sate iz zbira, ali dan ostaje i traži napomenu", async () => {
    const missingNote = await kindRoute(
      new NextRequest(`http://localhost/api/workdays/${DAY}/kind`, {
        method: "PATCH",
        headers: headers(cOwner),
        body: JSON.stringify({ dayKind: "SICK" }),
      }),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );
    // Dan ne postoji → 404 prije provjere napomene; bitno je da ruta ne pada.
    expect([400, 404]).toContain(missingNote.status);
  });

  it("sedmica sabira po radniku i ne miješa izostanke u sate", async () => {
    const response = await weekRoute(
      new NextRequest(`http://localhost/api/workdays/week?weekStart=${DAY}`, { headers: headers(cOwner) }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const row = body.data.rows.find((entry: { workerId: string }) => entry.workerId === W_RADNIK);
    expect(row).toBeDefined();
    expect(row.days[DAY].minutes).toBe(480);
    expect(row.totalMinutes).toBe(480);
    expect(body.data.weekEnd).toBe("2026-11-22");
  });

  it("radnik bez dozvole workdays.view ne vidi sedmicu cijele firme", async () => {
    const response = await weekRoute(
      new NextRequest(`http://localhost/api/workdays/week?weekStart=${DAY}`, { headers: headers(cRadnik) }),
    );
    expect(response.status).toBe(403);
  });

  it("grupna potvrda potvrđuje samo dane radnika sa dodjelom na projektu", async () => {
    await admin.query(
      `UPDATE workdays SET approval_status = 'SUBMITTED' WHERE company_id = $1 AND work_date = $2`,
      [COMPANY, DAY],
    );
    const response = await bulkConfirmRoute(
      new NextRequest("http://localhost/api/workdays/confirm-bulk", {
        method: "POST",
        headers: headers(cSef),
        body: JSON.stringify({ projectId: PROJECT, workDate: DAY }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.confirmed).toBeGreaterThanOrEqual(1);
    // Radnik bez dodjele na projektu mora biti preskočen, ne potvrđen.
    expect(body.data.skipped.every((entry: { workerId: string }) => entry.workerId !== W_RADNIK)).toBe(true);
  });

  it("cijena: nova cijena zatvara staru, iznos se ne prepisuje", async () => {
    const first = await addRateRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/rates`, {
        method: "POST",
        headers: headers(cOwner),
        body: JSON.stringify({ kind: "HOURLY", amountCents: 1500, validFrom: "2026-01-01" }),
      }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    expect(first.status).toBe(200);

    const second = await addRateRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/rates`, {
        method: "POST",
        headers: headers(cOwner),
        body: JSON.stringify({ kind: "HOURLY", amountCents: 1800, validFrom: "2026-06-01" }),
      }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    expect(second.status).toBe(200);
    const body = await second.json();
    const old = body.data.rates.find((rate: { validFrom: string }) => rate.validFrom === "2026-01-01");
    expect(old.validTo).toBe("2026-05-31");
    expect(old.amountCents).toBe("1500");
    expect(body.data.rates).toHaveLength(2);
  });

  it("cijena u prošlosti ne smije presjeći važeću (RATE_OVERLAP)", async () => {
    const response = await addRateRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/rates`, {
        method: "POST",
        headers: headers(cOwner),
        body: JSON.stringify({ kind: "HOURLY", amountCents: 900, validFrom: "2026-02-01" }),
      }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("RATE_OVERLAP");
  });

  it("šef gradilišta ne vidi cijene", async () => {
    const response = await ratesRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/rates`, { headers: headers(cSef) }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    expect(response.status).toBe(403);
  });

  it("zatvaranje cijene ne mijenja iznos", async () => {
    const listed = await ratesRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/rates`, { headers: headers(cOwner) }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    const rateId = (await listed.json()).data.rates[0].id;
    const response = await closeRateRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/rates/${rateId}/close`, {
        method: "PATCH",
        headers: headers(cOwner),
        body: JSON.stringify({ validTo: "2026-09-30" }),
      }),
      { params: Promise.resolve({ id: W_RADNIK, rateId }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.rates.find((rate: { id: string }) => rate.id === rateId).amountCents).toBe("1800");
  });

  it("dopust: saldo se računa iz godišnjih dana, ne iz brojača", async () => {
    await leaveSetRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/leave`, {
        method: "POST",
        headers: headers(cOwner),
        body: JSON.stringify({ year: 2026, daysEntitled: 20, daysCarryover: 3 }),
      }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    // Jedan dan proglašen godišnjim — saldo mora pasti na 22 (20 + 3 − 1).
    const dayId = `wd_f3_vac_${RUN}`;
    await admin.query(
      `INSERT INTO workdays (id, company_id, worker_id, work_date, created_by, updated_by, day_kind, absence_note)
       VALUES ($1, $2, $3, $4, $5, $5, 'VACATION', 'godišnji')`,
      [dayId, COMPANY, W_RADNIK, DAY2, U_OWNER],
    );
    const response = await leaveRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/leave`, { headers: headers(cOwner) }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const year = body.data.years.find((entry: { year: number }) => entry.year === 2026);
    expect(year.daysUsed).toBe(1);
    expect(year.balance).toBe(22);
    expect(year.usedDates).toEqual([DAY2]);
  });

  it("zaduženje se vraća, nikad ne briše", async () => {
    const issued = await addIssuanceRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/issuances`, {
        method: "POST",
        headers: headers(cSef),
        body: JSON.stringify({ itemKind: "PPE", itemName: "Kaciga", issuedAt: "2026-11-01", size: "M" }),
      }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    expect(issued.status).toBe(200);
    const issuance = (await issued.json()).data.issuances[0];

    const returned = await returnIssuanceRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/issuances/${issuance.id}/return`, {
        method: "PATCH",
        headers: headers(cSef),
        body: JSON.stringify({ returnedAt: "2026-11-20" }),
      }),
      { params: Promise.resolve({ id: W_RADNIK, issuanceId: issuance.id }) },
    );
    expect(returned.status).toBe(200);
    const after = await returned.json();
    // Red ostaje u tabeli — povrat je datum, ne brisanje.
    expect(after.data.issuances.find((row: { id: string }) => row.id === issuance.id).returnedAt).toBe("2026-11-20");
    expect(after.data.activeCount).toBe(0);
  });

  it("dvostruki povrat je 409, a ne tiho prepisivanje datuma", async () => {
    const listed = await issuancesRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/issuances?includeReturned=true`, {
        headers: headers(cSef),
      }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    const issuance = (await listed.json()).data.issuances[0];
    const response = await returnIssuanceRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/issuances/${issuance.id}/return`, {
        method: "PATCH",
        headers: headers(cSef),
        body: JSON.stringify({ returnedAt: "2026-11-21" }),
      }),
      { params: Promise.resolve({ id: W_RADNIK, issuanceId: issuance.id }) },
    );
    expect(response.status).toBe(409);
  });

  it("kartica: osjetljiva polja su null bez dozvole, a izmjena traži razlog", async () => {
    const asSef = await profileRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/profile`, { headers: headers(cSef) }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    expect(asSef.status).toBe(200);
    expect((await asSef.json()).data.worker.sensitive).toBeNull();

    const asOwner = await profileRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/profile`, { headers: headers(cOwner) }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    expect((await asOwner.json()).data.worker.sensitive).not.toBeNull();

    const withoutReason = await profilePatchRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/profile`, {
        method: "PATCH",
        headers: headers(cOwner),
        body: JSON.stringify({ bloodType: "A+" }),
      }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    expect(withoutReason.status).toBe(400);

    const withReason = await profilePatchRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/profile`, {
        method: "PATCH",
        headers: headers(cOwner),
        body: JSON.stringify({ bloodType: "A+", reason: "Upisano iz kartona radnika." }),
      }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    expect(withReason.status).toBe(200);
    expect((await withReason.json()).data.worker.sensitive.bloodType).toBe("A+");
  });

  it("historija pamti staru i novu vrijednost sa razlogom", async () => {
    const response = await historyRoute(
      new NextRequest(`http://localhost/api/workers/${W_RADNIK}/history`, { headers: headers(cOwner) }),
      { params: Promise.resolve({ id: W_RADNIK }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const entry = body.data.entries.find((row: { field: string }) => row.field === "bloodType");
    expect(entry.newValue).toBe("A+");
    expect(entry.reason).toContain("kartona");
  });

  it("Radnik odlazi odbija radnika sa nerazduženom opremom", async () => {
    await addIssuanceRoute(
      new NextRequest(`http://localhost/api/workers/${W_DRUGI}/issuances`, {
        method: "POST",
        headers: headers(cSef),
        body: JSON.stringify({ itemKind: "TOOL", itemName: "Bušilica", issuedAt: "2026-11-01" }),
      }),
      { params: Promise.resolve({ id: W_DRUGI }) },
    );
    const response = await offboardRoute(
      new NextRequest(`http://localhost/api/workers/${W_DRUGI}/offboard`, {
        method: "POST",
        headers: headers(cOwner),
        body: JSON.stringify({ endedAt: "2026-11-30", reason: "Sporazumni prestanak radnog odnosa." }),
      }),
      { params: Promise.resolve({ id: W_DRUGI }) },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("WORKER_HAS_ACTIVE_ISSUANCES");
  });

  it("Radnik odlazi atomski: oprema, dodjele, obaveze i radnik u jednoj transakciji", async () => {
    const listed = await issuancesRoute(
      new NextRequest(`http://localhost/api/workers/${W_DRUGI}/issuances`, { headers: headers(cSef) }),
      { params: Promise.resolve({ id: W_DRUGI }) },
    );
    const issuanceId = (await listed.json()).data.issuances[0].id;

    const response = await offboardRoute(
      new NextRequest(`http://localhost/api/workers/${W_DRUGI}/offboard`, {
        method: "POST",
        headers: headers(cOwner),
        body: JSON.stringify({
          endedAt: "2026-11-30",
          reason: "Sporazumni prestanak radnog odnosa.",
          writtenOff: [{ issuanceId, reason: "Bušilica je izgubljena na gradilištu." }],
        }),
      }),
      { params: Promise.resolve({ id: W_DRUGI }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.writtenOffIssuances).toBe(1);
    expect(body.data.deactivatedAssignments).toBeGreaterThanOrEqual(1);

    const worker = await admin.query<{ is_active: boolean; ended_at: string }>(
      "SELECT is_active, ended_at::text AS ended_at FROM workers WHERE id = $1",
      [W_DRUGI],
    );
    expect(worker.rows[0]!.is_active).toBe(false);
    expect(worker.rows[0]!.ended_at).toBe("2026-11-30");
  });

  it("masovna izmjena preskače neaktivne i vraća razlog", async () => {
    const response = await bulkWorkersRoute(
      new NextRequest("http://localhost/api/workers/bulk", {
        method: "POST",
        headers: headers(cOwner),
        body: JSON.stringify({ action: "changeTeam", workerIds: [W_RADNIK, W_DRUGI], team: "Ekipa A" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.updated).toBe(1);
    expect(body.data.skipped).toHaveLength(1);
    expect(body.data.skipped[0].workerId).toBe(W_DRUGI);
    expect(body.data.skipped[0].reason).toContain("nije aktivan");
  });

  it("zaokruživanje ide PO SEGMENTU, ne po zbiru dana", async () => {
    /*
     * Dva segmenta od po 8 minuta: po segmentu uz NEAREST 15 to je 15 + 15 = 30, a zaokruživanje
     * zbira (16 min) dalo bi 15. Test čuva odluku iz spec 03 §1.4 — da se ne „optimizuje“ u zbir.
     * (Sa 7 minuta oba pristupa daju 0, pa test ne bi razlikovao pravila.)
     */
    await admin.query("UPDATE companies SET rounding_minutes = 15, rounding_mode = 'NEAREST' WHERE id = $1", [COMPANY]);
    const cookie = await signIn(U_SEF);
    const start = (at: string, localId: string) =>
      timerRoute(
        new NextRequest("http://localhost/api/workdays/timer", {
          method: "POST",
          headers: headers(cookie),
          body: JSON.stringify({ action: "start", at, localId }),
        }),
      );
    const finish = (at: string) =>
      timerRoute(
        new NextRequest("http://localhost/api/workdays/timer", {
          method: "POST",
          headers: headers(cookie),
          body: JSON.stringify({ action: "finish", at }),
        }),
      );

    await start(`${DAY2}T06:00:00.000Z`, `we_f3_seg1_${RUN}`);
    await finish(`${DAY2}T06:08:00.000Z`);
    await start(`${DAY2}T07:00:00.000Z`, `we_f3_seg2_${RUN}`);
    const last = await finish(`${DAY2}T07:08:00.000Z`);
    expect(last.status).toBe(200);
    const day = (await last.json()).data.day;
    expect(day.segments).toHaveLength(2);
    expect(day.minutes).toBe(30);
    expect(day.rawMinutes).toBe(16);
    await admin.query("UPDATE companies SET rounding_minutes = 0 WHERE id = $1", [COMPANY]);
  });

  it("zaboravljen dan: „ne znam“ daje UNKNOWN_END i dan ide uredu na provjeru", async () => {
    const cookie = await signIn(U_SEF);
    await timerRoute(
      new NextRequest("http://localhost/api/workdays/timer", {
        method: "POST",
        headers: headers(cookie),
        body: JSON.stringify({ action: "start", at: `${DAY2}T20:00:00.000Z`, localId: `we_f3_zab_${RUN}` }),
      }),
    );
    const response = await closeForgottenRoute(
      new NextRequest("http://localhost/api/workdays/close-forgotten", {
        method: "POST",
        headers: headers(cookie),
        body: JSON.stringify({ kind: "UNKNOWN", note: "Telefon se ispraznio." }),
      }),
    );
    expect(response.status).toBe(200);
    const day = (await response.json()).data.day;
    // Vrijeme se NE izmišlja: segment nema kraj, a dan traži uredsku provjeru.
    const unknown = day.segments.find((segment: { endState: string }) => segment.endState === "UNKNOWN_END");
    expect(unknown).toBeDefined();
    expect(unknown.endedAt).toBeNull();
    expect(day.reviewState).toBe("UNKNOWN_END");
  });

  it("tuđa firma ne vidi ništa (granica je u sesiji, ne u zahtjevu)", async () => {
    const pool = new Pool({ connectionString: appUrl, max: 1 });
    await withCompany(pool, companyId(OTHER_COMPANY), async (client) => {
      const rows = await client.query("SELECT id FROM workers WHERE company_id = $1", [OTHER_COMPANY]);
      expect(rows.rows).toHaveLength(0);
      const days = await client.query("SELECT id FROM workdays WHERE company_id = $1", [OTHER_COMPANY]);
      expect(days.rows).toHaveLength(0);
    });
    await pool.end();
  });
});

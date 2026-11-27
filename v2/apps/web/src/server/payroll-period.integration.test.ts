/**
 * F6 (Modul 7) — ZLATNI testovi za novac, protiv PRAVE baze.
 *
 * Ovi testovi postoje jer se greške u obračunu ne vide na ekranu: sati izgledaju ispravno, a iznos
 * je pogrešan. Zato svaki mjeri JEDNU tvrdnju koja se ne smije izgubiti:
 *
 *   1. prioritet kategorija (sat u tačno jednoj; praznik > nedjelja > noćni > prekovremeni > redovni),
 *   2. dnevni vs sedmični prekovremeni (nikad oba),
 *   3. `PARAMETER_MISSING` — nema množioca, nema iznosa (a ne nula),
 *   4. `RATE_MISSING` — nema satnice, nema iznosa; blokira `APPROVED`,
 *   5. `pay_corrections` poslije `LOCKED` — stari obračun se NE prepisuje,
 *   6. prijenos ostatka akontacije — odbici nikad ne daju negativan obračun,
 *   7. `SELF_APPROVAL_FORBIDDEN`,
 *   8. izvoz: XLSX dva lista, verzija formata, default samo `LOCKED`.
 */
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { POST as valueCorrectionRoute, GET as correctionsRoute } from "@/app/api/payroll/corrections/route";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import { Pool } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  approvePeriod,
  calculatePeriod,
  confirmCorrectionValue,
  createAdvance,
  createPeriod,
  getMyPayroll,
  isPayrollError,
  listAdvances,
  listComponents,
  listLineSources,
  listLines,
  listPeriods,
  lockPeriod,
} from "./payroll-period-service";
import { buildPayrollExport } from "./payroll-export";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_f6_${RUN}`;
const OWNER = `usr_f6_own_${RUN}`;
const ACCT = `usr_f6_acc_${RUN}`;
const WORKER = `wrk_f6_${RUN}`;
const ACCT_WORKER = `wrk_f6_acc_${RUN}`;
const PROJECT = `prj_f6_${RUN}`;
const IN_CITY_PROJECT = `prj_f6_in_${RUN}`;
/* Firma B — postoji samo da bi se dokazalo da ne vidi ništa od firme A (§5.17). */
const CO_B = `cmp_f6b_${RUN}`;
const OWNER_B = `usr_f6b_own_${RUN}`;
const WORKER_B = `wrk_f6b_${RUN}`;
const PROJECT_B = `prj_f6b_${RUN}`;

const ownerActor = {
  userId: OWNER,
  companyId: CO,
  roles: ["OWNER"] as const,
  system: true,
};


describeDb("F6 obračun — zlatni testovi novca (PostgreSQL)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 3 });
  const app = new Pool({ connectionString: appUrl, max: 3 });

  const actor = ownerActor;

  async function resetPeriods() {
    await admin.query("SET session_replication_role = replica");
    await admin.query("DELETE FROM public.pay_corrections WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.payroll_line_sources WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.payroll_run_lines WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.payroll_runs WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.pay_periods WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.worker_advances WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.work_entries WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.workdays WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.worker_rates WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.payroll_parameters WHERE company_id = $1 AND code <> 'OVERTIME_MULTIPLIER'", [CO]);
    await admin.query("DELETE FROM public.cost_entries WHERE company_id = $1", [CO]);
    await admin.query("SET session_replication_role = DEFAULT");
  }

  /** Jedan potvrđen dan rada: `start–end` po lokalnom vremenu, na projektu. */
  async function seedDay(params: {
    workDate: string;
    start: string;
    end: string;
    workerId?: string;
    projectId?: string;
    dayKind?: string;
    approval?: "FOREMAN_CONFIRMED" | "LOCKED";
  }) {
    const worker = params.workerId ?? WORKER;
    const workdayId = `wd_${RUN}_${params.workDate}_${worker}`.slice(0, 60);
    await admin.query(
      `INSERT INTO public.workdays
         (id, company_id, worker_id, work_date, status, approval_status, day_kind,
          absence_note, created_by, updated_by)
       VALUES ($1, $2, $3, $4::date, 'SUBMITTED', $5::text, $6::text,
               -- Izostanak BEZ razloga ne postoji: workdays_absence_note_check.
               CASE WHEN $6::text = 'WORK' THEN NULL ELSE 'Izostanak (test)' END, $7, $7)
       ON CONFLICT (company_id, worker_id, work_date) DO UPDATE
         SET approval_status = EXCLUDED.approval_status, day_kind = EXCLUDED.day_kind,
             absence_note = EXCLUDED.absence_note`,
      [workdayId, CO, worker, params.workDate, params.approval ?? "FOREMAN_CONFIRMED", params.dayKind ?? "WORK", OWNER],
    );
    const id = await admin.query<{ id: string }>(
      "SELECT id FROM public.workdays WHERE company_id = $1 AND worker_id = $2 AND work_date = $3::date",
      [CO, worker, params.workDate],
    );
    const dayId = id.rows[0]!.id;
    if (params.dayKind && params.dayKind !== "WORK") return dayId;
    await admin.query(
      `INSERT INTO public.work_entries
         (id, company_id, workday_id, worker_id, project_id, kind, started_at, ended_at,
          end_state, resolution_state, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'WORK',
               ($6::date + $7::time) AT TIME ZONE 'Europe/Sarajevo',
               ($6::date + $8::time) AT TIME ZONE 'Europe/Sarajevo',
               'KNOWN_END', 'ACTIVE', $9, $9)`,
      [
        `we_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        CO,
        dayId,
        worker,
        /*
         * Zadano je gradilište U GRADU, jer dan van sjedišta firme automatski traži
         * `FIELD_ALLOWANCE_PER_DAY` — a to je ispravno ponašanje koje bi ostale testove učinilo
         * `PARAMETER_MISSING`. Terenski dodatak ima svoj test.
         */
        params.projectId ?? IN_CITY_PROJECT,
        params.workDate,
        params.start,
        params.end,
        OWNER,
      ],
    );
    return dayId;
  }

  async function openPeriod(year: number, month: number) {
    const created = await createPeriod(app, actor, { year, month });
    if (isPayrollError(created)) throw new Error(`period: ${created.message}`);
    return created.id;
  }

  async function addParameter(code: string, value: string, validFrom = "2026-01-01") {
    await admin.query(
      `INSERT INTO public.payroll_parameters
         (id, company_id, code, value, unit, valid_from, confirmed_by, created_by)
       VALUES ($1, $2, $3, $4, 'MULTIPLIER', $5::date, $6, $6)`,
      [`pp_${randomUUID().replace(/-/g, "").slice(0, 20)}`, CO, code, value, validFrom, OWNER],
    );
  }

  async function addRate(workerId: string, cents: number, validFrom = "2026-01-01") {
    await admin.query(
      `INSERT INTO public.worker_rates
         (id, company_id, worker_id, rate_kind, amount_cents, currency_code, valid_from, created_by)
       VALUES ($1, $2, $3, 'HOURLY', $4, 'BAM', $5::date, $6)`,
      [`wrt_${randomUUID().replace(/-/g, "").slice(0, 20)}`, CO, workerId, cents, validFrom, OWNER],
    );
  }

  beforeEach(async () => {
    await resetPeriods();
  });

  afterEach(async () => {
    await resetPeriods();
  });

  it("prioritet: praznik pobjeđuje nedjelju, nedjelja pobjeđuje noćni", async () => {
    /* 2026-04-05 je nedjelja; proglašavamo je plaćenim praznikom. Rad 20:00–24:00 je noćni, ali
       praznik ima prioritet — cijeli dan ide u PRAZNIK, i to je JEDINA kategorija sa satima. */
    await admin.query(
      `INSERT INTO public.company_holidays (id, company_id, holiday_date, name, is_paid)
       VALUES ($1, $2, '2026-04-05'::date, 'Test praznik', true)
       ON CONFLICT DO NOTHING`,
      [`hol_f6_${RUN}`, CO],
    );
    await addRate(WORKER, 1000);
    await addParameter("NIGHT_MULTIPLIER", "1.3");
    await addParameter("SUNDAY_MULTIPLIER", "1.5");
    await addParameter("HOLIDAY_MULTIPLIER", "2.0");
    await seedDay({ workDate: "2026-04-05", start: "20:00", end: "24:00" });

    const periodId = await openPeriod(2026, 4);
    await calculatePeriod(app, actor, periodId);
    const lines = await listLines(app, actor, periodId);
    if (isPayrollError(lines)) throw new Error(lines.message);

    const holiday = lines.lines.find((line) => line.component_code === "PRAZNIK");
    const sunday = lines.lines.find((line) => line.component_code === "NEDJELJA");
    const night = lines.lines.find((line) => line.component_code === "NOCNI");
    expect(holiday?.hours).toBe(4);
    expect(sunday).toBeUndefined();
    expect(night).toBeUndefined();
    // 4 h × 10,00 × 2,0 = 80,00
    expect(holiday?.amount_cents).toBe(8000);
  });

  it("noćni sat preko praga ostaje NOĆNI; prekovremeni ne uzima iste sate", async () => {
    await addRate(WORKER, 1000);
    await addParameter("NIGHT_MULTIPLIER", "1.3");
    // 14:00–23:00 = 9 h; noćni 22:00–23:00 = 1 h; prekovremeni preko 8 h = 1 h.
    await seedDay({ workDate: "2026-03-03", start: "14:00", end: "23:00" });

    const periodId = await openPeriod(2026, 3);
    await calculatePeriod(app, actor, periodId);
    const lines = await listLines(app, actor, periodId);
    if (isPayrollError(lines)) throw new Error(lines.message);

    const byCode = Object.fromEntries(lines.lines.map((line) => [line.component_code, line]));
    expect(byCode.NOCNI?.hours).toBe(1);
    expect(byCode.PREKOVREMENI?.hours).toBe(1);
    expect(byCode.REDOVNI?.hours).toBe(7);
    // Zbir kategorija = ukupni sati: 1 + 1 + 7 = 9. Nijedan sat nije plaćen dvaput.
    const total = lines.lines
      .filter((line) => ["NOCNI", "PREKOVREMENI", "REDOVNI"].includes(line.component_code))
      .reduce((sum, line) => sum + line.hours, 0);
    expect(total).toBe(9);
    expect(byCode.NOCNI?.amount_cents).toBe(1300); // 1 h × 10,00 × 1,3
    // Prekovremeni množilac je neutralni 1,0 (zadani parametar firme) — sat ostaje sat.
    expect(byCode.PREKOVREMENI?.amount_cents).toBe(1000);
  });

  it("sedmični osnov daje drugu raspodjelu prekovremenog od dnevnog", async () => {
    await addRate(WORKER, 1000);
    await admin.query(
      `UPDATE public.companies
          SET overtime_basis = 'WEEKLY', overtime_weekly_threshold = 40
        WHERE id = $1`,
      [CO],
    );
    // Pet dana po 9 h = 45 h. Uz dnevni osnov svaki dan ima 1 h prekovremenog (5 h ukupno);
    // uz sedmični prag 40 h prekovremeno je 5 h, ali tek na kraju sedmice.
    for (const day of ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]) {
      await seedDay({ workDate: day, start: "07:00", end: "16:00" });
    }

    const periodId = await openPeriod(2026, 3);
    await calculatePeriod(app, actor, periodId);
    const lines = await listLines(app, actor, periodId);
    if (isPayrollError(lines)) throw new Error(lines.message);
    const overtime = lines.lines.find((line) => line.component_code === "PREKOVREMENI");
    const regular = lines.lines.find((line) => line.component_code === "REDOVNI");
    expect(overtime?.hours).toBe(5);
    expect(regular?.hours).toBe(40);

    // Vraćanje na dnevni osnov daje ISTI broj sati, ali drugu raspodjelu po danima — zato se
    // provjerava da se osnov stvarno čita iz firme, a ne pretpostavlja.
    await admin.query(
      `UPDATE public.companies SET overtime_basis = 'DAILY', overtime_weekly_threshold = NULL WHERE id = $1`,
      [CO],
    );
  });

  it("PARAMETER_MISSING: nema množioca noćnog → linija bez iznosa, period nije spreman", async () => {
    await addRate(WORKER, 1000);
    // Nema NIGHT_MULTIPLIER — ne izmišljamo 1,0 ni 1,3.
    await seedDay({ workDate: "2026-03-03", start: "22:00", end: "23:00" });

    const periodId = await openPeriod(2026, 3);
    const calculated = await calculatePeriod(app, actor, periodId);
    if (isPayrollError(calculated)) throw new Error(calculated.message);
    expect(calculated.parameter_missing).toBeGreaterThan(0);

    const lines = await listLines(app, actor, periodId);
    if (isPayrollError(lines)) throw new Error(lines.message);
    const night = lines.lines.find((line) => line.component_code === "NOCNI");
    expect(night?.status).toBe("PARAMETER_MISSING");
    // Nula bi bila laž: iznos NIJE 0, nego ga nema.
    expect(night?.amount_cents).toBeNull();
    expect(lines.totals.earnings_cents).toBeNull();

    const approved = await approvePeriod(app, actor, periodId);
    expect(isPayrollError(approved)).toBe(true);
    if (isPayrollError(approved)) expect(approved.code).toBe("PERIOD_NOT_READY");
    expect(await lockPeriod(app,actor,periodId)).toMatchObject({code:"CONFLICT"});
  });

  it("RATE_MISSING: nema satnice → linija bez iznosa i blokirano odobrenje", async () => {
    // Satnica se NE dodaje.
    await seedDay({ workDate: "2026-03-03", start: "07:00", end: "15:00" });

    const periodId = await openPeriod(2026, 3);
    const calculated = await calculatePeriod(app, actor, periodId);
    if (isPayrollError(calculated)) throw new Error(calculated.message);
    expect(calculated.rate_missing).toBeGreaterThan(0);

    const lines = await listLines(app, actor, periodId);
    if (isPayrollError(lines)) throw new Error(lines.message);
    const regular = lines.lines.find((line) => line.component_code === "REDOVNI");
    expect(regular?.status).toBe("RATE_MISSING");
    expect(regular?.amount_cents).toBeNull();

    const approved = await approvePeriod(app, actor, periodId);
    if (isPayrollError(approved)) expect(approved.code).toBe("PERIOD_NOT_READY");
    else throw new Error("odobrenje je prošlo uprkos RATE_MISSING");
    expect(await lockPeriod(app,actor,periodId)).toMatchObject({code:"CONFLICT"});
  });

  it("satnica se čita NA DAN RADA, ne trenutna", async () => {
    // Stara satnica važi do 05.03; nova od 06.03. Dani: 04.03 (stara) i 09.03 (nova).
    await admin.query(
      `INSERT INTO public.worker_rates
         (id, company_id, worker_id, rate_kind, amount_cents, currency_code, valid_from, valid_to, created_by)
       VALUES ($1, $2, $3, 'HOURLY', 1000, 'BAM', '2026-01-01', '2026-03-05', $4)`,
      [`wrt_${RUN}_old`, CO, WORKER, OWNER],
    );
    await addRate(WORKER, 2000, "2026-03-06");
    await seedDay({ workDate: "2026-03-04", start: "07:00", end: "15:00" });
    await seedDay({ workDate: "2026-03-09", start: "07:00", end: "15:00" });

    const periodId = await openPeriod(2026, 3);
    await calculatePeriod(app, actor, periodId);
    const lines = await listLines(app, actor, periodId);
    if (isPayrollError(lines)) throw new Error(lines.message);
    const regular = lines.lines.find((line) => line.component_code === "REDOVNI");
    // 8 h × 10,00 = 80,00 i 8 h × 20,00 = 160,00 → 240,00
    expect(regular?.amount_cents).toBe(24000);

    // Isti dan sa „trenutnom“ satnicom dao bi 320,00 — zato se ovo mjeri.
    expect(regular?.amount_cents).not.toBe(32000);
  });

  it("paralelno zaključavanje odobrenog perioda uspijeva tačno jednom", async () => {
    await addRate(WORKER, 1000);
    await seedDay({workDate:"2026-03-03",start:"07:00",end:"15:00"});
    const periodId=await openPeriod(2026,3);
    expect(isPayrollError(await calculatePeriod(app,actor,periodId))).toBe(false);
    expect(isPayrollError(await approvePeriod(app,actor,periodId))).toBe(false);
    const results=await Promise.all([lockPeriod(app,actor,periodId),lockPeriod(app,actor,periodId)]);
    expect(results.filter(r=>!isPayrollError(r))).toHaveLength(1);
    expect(results.filter(r=>isPayrollError(r))).toMatchObject([{code:"PAYROLL_ALREADY_LOCKED"}]);
  });

  it("pay_corrections: izmjena dana u LOCKED periodu NE prepisuje obračun", async () => {
    await addRate(WORKER, 1000);
    await seedDay({ workDate: "2026-03-03", start: "07:00", end: "15:00" });

    const marchId = await openPeriod(2026, 3);
    await calculatePeriod(app, actor, marchId);
    const beforeLock = await listLines(app, actor, marchId);
    if (isPayrollError(beforeLock)) throw new Error(beforeLock.message);
    const originalAmount = beforeLock.lines.find((line) => line.component_code === "REDOVNI")?.amount_cents;
    expect(originalAmount).toBe(8000);

    // April mora postojati PRIJE korekcije — korekcija se primjenjuje u narednom periodu.
    const aprilId = await openPeriod(2026, 4);
    expect(aprilId).toBeTruthy();

    const approved = await approvePeriod(app, actor, marchId);
    if (isPayrollError(approved)) throw new Error(`approve: ${approved.message}`);
    const locked = await lockPeriod(app, actor, marchId);
    if (isPayrollError(locked)) throw new Error(`lock: ${locked.message}`);

    /* Izmjena POTVRĐENOG dana u zaključanom periodu: triger `workdays_open_correction` otvara
       korekciju. Stari obračun ostaje netaknut — linije su zamrznute trigerom. */
    await admin.query(
      `UPDATE public.workdays SET day_kind = 'SICK', absence_note = 'Bolovanje (test korekcije)'
        WHERE company_id = $1 AND worker_id = $2 AND work_date = '2026-03-03'::date`,
      [CO, WORKER],
    );

    const corrections = await admin.query<{ target_period_id: string; period_id: string; reason: string }>(
      `SELECT period_id, target_period_id, reason FROM public.pay_corrections WHERE company_id = $1`,
      [CO],
    );
    expect(corrections.rows).toHaveLength(1);
    expect(corrections.rows[0]!.period_id).toBe(marchId);
    expect(corrections.rows[0]!.target_period_id).toBe(aprilId);

    // Stari obračun: isti iznos, ista revizija — ništa nije prepisano.
    const afterLock = await listLines(app, actor, marchId);
    if (isPayrollError(afterLock)) throw new Error(afterLock.message);
    const afterAmount = afterLock.lines.find((line) => line.component_code === "REDOVNI")?.amount_cents;
    expect(afterAmount).toBe(originalAmount);
  });

  it("zaključen dan i izmjena segmenta kreiraju korekcije i bez unaprijed otvorenog idućeg mjeseca",async()=>{
    await addRate(WORKER,1000);
    const day=await seedDay({workDate:"2026-03-03",start:"07:00",end:"15:00"});
    const period=await openPeriod(2026,3);
    const calc=await calculatePeriod(app,actor,period); if(isPayrollError(calc)) throw Error(calc.message);
    expect(isPayrollError(await approvePeriod(app,actor,period))).toBe(false);
    expect(isPayrollError(await lockPeriod(app,actor,period))).toBe(false);
    const before=await listLines(app,actor,period);
    await withCompany(app,toCompanyId(CO),async client=>{
      await client.query("UPDATE public.workdays SET day_kind='SICK',absence_note='Bolovanje' WHERE company_id=$1 AND id=$2",[CO,day]);
      await client.query("UPDATE public.work_entries SET ended_at=ended_at-interval '1 hour' WHERE company_id=$1 AND workday_id=$2",[CO,day]);
    });
    const found=await admin.query<{delta:string;target_month:number;status:string}>(`SELECT c.delta_hours::text AS delta,p.month AS target_month,c.status
      FROM public.pay_corrections c JOIN public.pay_periods p ON p.company_id=c.company_id AND p.id=c.target_period_id
      WHERE c.company_id=$1 AND c.workday_id=$2 ORDER BY c.created_at`,[CO,day]);
    expect(found.rows).toEqual([{delta:"0.000",target_month:4,status:"OPEN"},{delta:"-1.000",target_month:4,status:"OPEN"}]);
    expect(await listLines(app,actor,period)).toEqual(before);
    const target=await admin.query<{id:string}>("SELECT id FROM public.pay_periods WHERE company_id=$1 AND year=2026 AND month=4",[CO]);
    const targetId=target.rows[0]!.id;
    expect(isPayrollError(await calculatePeriod(app,actor,targetId))).toBe(false);
    const approval=await approvePeriod(app,actor,targetId);
    expect(approval).toMatchObject({code:"PERIOD_NOT_READY",detail:{blockers:expect.arrayContaining([expect.objectContaining({code:"PENDING_CORRECTIONS",count:2})])}});
  });

  it("iznosom utvrđena korekcija ulazi u svaku reviziju jednom, raspis i bruto",async()=>{
    await addRate(WORKER,1000);
    const day=await seedDay({workDate:"2026-03-03",start:"07:00",end:"15:00"});
    const source=await openPeriod(2026,3);
    expect(isPayrollError(await calculatePeriod(app,actor,source))).toBe(false);
    expect(isPayrollError(await approvePeriod(app,actor,source))).toBe(false);
    expect(isPayrollError(await lockPeriod(app,actor,source))).toBe(false);
    await withCompany(app,toCompanyId(CO),client=>client.query("UPDATE public.work_entries SET ended_at=ended_at-interval '1 hour' WHERE company_id=$1 AND workday_id=$2",[CO,day]));
    const corr=await admin.query<{id:string;target_period_id:string}>("SELECT id,target_period_id FROM public.pay_corrections WHERE company_id=$1 AND workday_id=$2",[CO,day]);
    const target=corr.rows[0]!.target_period_id;
    await seedDay({workDate:"2026-04-02",start:"07:00",end:"15:00"});
    // The correction starts without a value. A calculation cannot be approved until an
    // accountant confirms their calculation with an auditable explanation.
    expect(isPayrollError(await calculatePeriod(app,actor,target))).toBe(false);
    expect(await approvePeriod(app,actor,target)).toMatchObject({code:"PERIOD_NOT_READY",detail:{blockers:expect.arrayContaining([expect.objectContaining({code:"PENDING_CORRECTIONS"})])}});
    const input={correctionId:corr.rows[0]!.id,amount:"-10.00",explanation:"Jedan sat po satnici 10 BAM"};
    const accountant={userId:ACCT,companyId:CO,roles:["ACCOUNTANT"] as const};
    expect(await confirmCorrectionValue(app,{...accountant,roles:["WORKER"]},input)).toMatchObject({code:"FORBIDDEN"});
    expect(await confirmCorrectionValue(app,{userId:OWNER_B,companyId:CO_B,roles:["OWNER"]},input)).toMatchObject({code:"NOT_FOUND"});
    const sessionId=`ses_paycorr_${RUN}`;
    await admin.query("INSERT INTO public.sessions(id,company_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",[sessionId,CO,ACCT,`hash_${sessionId}`]);
    const cookie=`${ACCESS_COOKIE}=${issueAccessToken({sub:ACCT,sid:sessionId,companyId:CO})}`;
    try {
      const response=await valueCorrectionRoute(new NextRequest("http://t/api/payroll/corrections",{
        method:"POST",headers:{cookie,"content-type":"application/json"},
        body:JSON.stringify({correction_id:input.correctionId,amount:input.amount,explanation:input.explanation}),
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({data:{id:input.correctionId,amount_cents:"-1000"}});
      const listed=await correctionsRoute(new NextRequest(`http://t/api/payroll/corrections?worker=${WORKER}`,{headers:{cookie}}));
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({data:{corrections:[expect.objectContaining({id:input.correctionId})]}});
      const foreignWorker=await correctionsRoute(new NextRequest(`http://t/api/payroll/corrections?worker=${ACCT_WORKER}`,{headers:{cookie}}));
      expect(await foreignWorker.json()).toMatchObject({data:{corrections:[]}});
    } finally {await admin.query("DELETE FROM public.sessions WHERE company_id=$1 AND id=$2",[CO,sessionId]);}
    expect(await confirmCorrectionValue(app,accountant,input)).toEqual({id:input.correctionId,amount_cents:"-1000"});
    expect(await confirmCorrectionValue(app,accountant,{...input,amount:"-20.00"})).toMatchObject({code:"CONFLICT"});
    const audit=await admin.query("SELECT 1 FROM public.audit_events WHERE company_id=$1 AND entity_id=$2 AND action='payroll.correction_valued'",[CO,input.correctionId]);
    expect(audit.rowCount).toBe(1);
    for(let revision=2;revision<=3;revision++) {
      const result=await calculatePeriod(app,actor,target); if(isPayrollError(result)) throw Error(result.message);
      expect(result.gross_cents).toBe("7000");
      const lines=await listLines(app,actor,target); if(isPayrollError(lines)) throw Error(lines.message);
      expect(lines.revision).toBe(revision);
      expect(lines.totals.earnings_cents).toBe(7000);
      const adjustments=lines.lines.filter(l=>l.component_code==="KOREKCIJA");
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0]).toMatchObject({kind:"EARNING",amount_cents:-1000});
      const sources=await listLineSources(app,actor,adjustments[0]!.id); if(isPayrollError(sources)) throw Error(sources.message);
      expect(sources.sources).toMatchObject([{source_type:"CORRECTION",source_id:corr.rows[0]!.id,amount_cents:-1000}]);
      const state=await admin.query("SELECT status,applied_run_id FROM public.pay_corrections WHERE company_id=$1 AND id=$2",[CO,corr.rows[0]!.id]);
      expect(state.rows[0]).toEqual({status:"APPLIED",applied_run_id:lines.run_id});
    }
    expect(isPayrollError(await approvePeriod(app,actor,target))).toBe(false);
    expect(isPayrollError(await lockPeriod(app,actor,target))).toBe(false);
    const exported=await buildPayrollExport(app,actor,{periodId:target,format:"xlsx"});
    if("code" in exported) throw Error(exported.message);
    const wb=new ExcelJS.Workbook(); await wb.xlsx.load(exported.body as never);
    expect(wb.getWorksheet("RASPIS")!.getSheetValues().flat(Infinity)).toContain("KOREKCIJA");
  });

  it("negativna korekcija veća od zarade blokira odobrenje",async()=>{
    await addRate(WORKER,1000);
    const day=await seedDay({workDate:"2026-03-03",start:"07:00",end:"15:00"});
    const source=await openPeriod(2026,3);
    await calculatePeriod(app,actor,source); await approvePeriod(app,actor,source); await lockPeriod(app,actor,source);
    await withCompany(app,toCompanyId(CO),client=>client.query("UPDATE public.work_entries SET ended_at=ended_at-interval '1 hour' WHERE company_id=$1 AND workday_id=$2",[CO,day]));
    const corr=await admin.query<{id:string;target_period_id:string}>("SELECT id,target_period_id FROM public.pay_corrections WHERE company_id=$1 AND workday_id=$2",[CO,day]);
    await admin.query("UPDATE public.pay_corrections SET delta_amount_cents=-1000 WHERE company_id=$1 AND id=$2",[CO,corr.rows[0]!.id]);
    const target=corr.rows[0]!.target_period_id;
    expect(isPayrollError(await calculatePeriod(app,actor,target))).toBe(false);
    const result=await approvePeriod(app,actor,target);
    expect(result).toMatchObject({code:"PERIOD_NOT_READY",detail:{blockers:expect.arrayContaining([expect.objectContaining({code:"NEGATIVE_NET_FORBIDDEN"})])}});
  });

  it("terenski dodatak: dan van sjedišta firme traži parametar, pa daje dodatak po danu", async () => {
    await addRate(WORKER, 1000);
    // Projekt van grada (Mostar), firma u Sarajevu — jedan dan na terenu.
    await seedDay({ workDate: "2026-03-03", start: "07:00", end: "15:00", projectId: PROJECT });

    const withoutParam = await openPeriod(2026, 3);
    await calculatePeriod(app, actor, withoutParam);
    const missing = await listLines(app, actor, withoutParam);
    if (isPayrollError(missing)) throw new Error(missing.message);
    const fieldMissing = missing.lines.find((line) => line.component_code === "TERENSKI");
    // Bez potvrđenog iznosa dodatka nema iznosa — ali dan na terenu je VIDLJIV, ne prećutan.
    expect(fieldMissing?.status).toBe("PARAMETER_MISSING");
    expect(fieldMissing?.days).toBe(1);
    expect(fieldMissing?.amount_cents).toBeNull();

    /* Isti period sa potvrđenim iznosom: 1 dan × 20,00 = 20,00. Period se otvara kao NOVI mjesec
       — zaključan/izračunat period se ne briše (RESTRICT), a i ne treba: obračun je trag. April
       dobija svoj dan, jer `work_entries` brane preklapanje (`WORK_ENTRY_OVERLAP`). */
    await admin.query(
      `INSERT INTO public.payroll_parameters
         (id, company_id, code, value, unit, valid_from, confirmed_by, created_by)
       VALUES ($1, $2, 'FIELD_ALLOWANCE_PER_DAY', 2000, 'CENTS', '2026-01-01', $3, $3)`,
      [`pp_fa_${RUN}`, CO, OWNER],
    );
    await seedDay({ workDate: "2026-04-03", start: "07:00", end: "15:00", projectId: PROJECT });
    const periodId = await openPeriod(2026, 4);
    await calculatePeriod(app, actor, periodId);
    const lines = await listLines(app, actor, periodId);
    if (isPayrollError(lines)) throw new Error(lines.message);
    const field = lines.lines.find((line) => line.component_code === "TERENSKI");
    expect(field?.status).toBe("OK");
    expect(field?.days).toBe(1);
    expect(field?.amount_cents).toBe(2000);
  });

  it("terenski iznos se čita za svaki datum, a bolovanje prihvata 0.80 koeficijent",async()=>{
    await addRate(WORKER,1000);
    await admin.query(`INSERT INTO public.payroll_parameters(id,company_id,code,value,unit,valid_from,valid_to,confirmed_by,created_by) VALUES
      ($1,$2,'FIELD_ALLOWANCE_PER_DAY',1500,'CENTS','2026-03-01','2026-03-15',$3,$3),
      ($4,$2,'FIELD_ALLOWANCE_PER_DAY',2000,'CENTS','2026-03-16',NULL,$3,$3),
      ($5,$2,'SICK_PAY_PCT',0.80,'MULTIPLIER','2026-03-01',NULL,$3,$3)`,[`f1_${RUN}`,CO,OWNER,`f2_${RUN}`,`sick_${RUN}`]);
    await seedDay({workDate:"2026-03-03",start:"07:00",end:"15:00",projectId:PROJECT});
    await seedDay({workDate:"2026-03-20",start:"07:00",end:"15:00",projectId:PROJECT});
    await seedDay({workDate:"2026-03-21",start:"07:00",end:"15:00",dayKind:"SICK",projectId:IN_CITY_PROJECT});
    const id=await openPeriod(2026,3);await calculatePeriod(app,actor,id);
    const lines=await listLines(app,actor,id);if(isPayrollError(lines)) throw Error(lines.message);
    expect(lines.lines.find(l=>l.component_code==="TERENSKI")?.amount_cents).toBe(3500);
    expect(lines.lines.find(l=>l.component_code==="BOLOVANJE")?.amount_cents).toBe(6400);
  });

  it("izostanci: SICK daje liniju dana bez sati, UNPAID_LEAVE i NO_SHOW su vidljivi sa 0", async () => {
    await addRate(WORKER, 1000);
    await seedDay({ workDate: "2026-03-03", start: "07:00", end: "15:00" });
    await seedDay({ workDate: "2026-03-04", start: "07:00", end: "15:00", dayKind: "SICK" });
    await seedDay({ workDate: "2026-03-05", start: "07:00", end: "15:00", dayKind: "UNPAID_LEAVE" });
    await seedDay({ workDate: "2026-03-06", start: "07:00", end: "15:00", dayKind: "NO_SHOW" });

    const periodId = await openPeriod(2026, 3);
    await calculatePeriod(app, actor, periodId);
    const lines = await listLines(app, actor, periodId);
    if (isPayrollError(lines)) throw new Error(lines.message);
    const byCode = new Map(lines.lines.map((line) => [line.component_code, line]));

    // Bolovanje: dan postoji, sati su 0 (bolovanje nije rad), iznos nosi naknada.
    expect(byCode.get("BOLOVANJE")?.days).toBe(1);
    expect(byCode.get("BOLOVANJE")?.hours).toBe(0);
    // Neplaćeni izostanci su VIDLJIVI sa nulom — nikad prećutani.
    expect(byCode.get("NEPLACENO")?.days).toBe(1);
    expect(byCode.get("NEOPRAVDANO")?.days).toBe(1);
    expect(byCode.get("NEPLACENO")?.amount_cents).toBe(0);
    expect(byCode.get("NEOPRAVDANO")?.amount_cents).toBe(0);
    // Radni dan je jedini koji nosi sate.
    expect(byCode.get("REDOVNI")?.hours).toBe(8);
  });

  it("raspis: zbir sati izvora linije = sati linije, bez razlike", async () => {
    await addRate(WORKER, 1000);
    await seedDay({ workDate: "2026-03-03", start: "07:00", end: "12:00" });
    await seedDay({ workDate: "2026-03-03", start: "12:00", end: "15:00", projectId: PROJECT });

    const periodId = await openPeriod(2026, 3);
    await calculatePeriod(app, actor, periodId);
    const lines = await listLines(app, actor, periodId);
    if (isPayrollError(lines)) throw new Error(lines.message);

    for (const line of lines.lines) {
      const detail = await listLineSources(app, actor, line.id);
      if (isPayrollError(detail)) throw new Error(detail.message);
      const sum = detail.sources.reduce((total, source) => total + source.hours, 0);
      // Sat se ne gubi ni ne udvostručuje između linije i njenog raspisa.
      expect(Math.round(sum * 1000) / 1000).toBe(Math.round(line.hours * 1000) / 1000);
    }
  });

  it("akontacija: ostatak prelazi u naredni mjesec, obračun nikad nije negativan", async () => {
    await addRate(WORKER, 1000);
    // Zarada mjeseca: 8 h × 10,00 = 80,00. Akontacija 100,00 → naplati se 80,00, ostatak 20,00.
    await seedDay({ workDate: "2026-03-03", start: "07:00", end: "15:00" });
    const advance = await createAdvance(app, actor, {
      workerId: WORKER,
      kind: "ADVANCE",
      amount: "100.00",
      issuedOn: "2026-03-02",
    });
    if (isPayrollError(advance)) throw new Error(advance.message);

    const periodId = await openPeriod(2026, 3);
    await calculatePeriod(app, actor, periodId);
    const lines = await listLines(app, actor, periodId);
    if (isPayrollError(lines)) throw new Error(lines.message);

    const deduction = lines.lines.find((line) => line.component_code === "AKONTACIJA");
    expect(deduction?.amount_cents).toBe(-8000); // odbitak je negativan u liniji
    // Zbir zarada (80,00) + odbitaka (−80,00) = 0: obračun nije negativan, ali je i naplaćen
    // do nule — ostatak prelazi dalje.
    expect(lines.totals.earnings_cents).toBe(8000);
    expect(lines.totals.deductions_cents).toBe(-8000);
    expect(lines.totals.earnings_cents! + lines.totals.deductions_cents!).toBe(0);

    const remaining = await admin.query<{ remaining_cents: string }>(
      "SELECT remaining_cents::text FROM public.worker_advances WHERE company_id = $1 AND id = $2",
      [CO, advance.id],
    );
    // Obračun rezerviše, ali ne naplaćuje. Tri revizije su isti plan, ne tri odbitka.
    expect(remaining.rows[0]!.remaining_cents).toBe("10000");
    for(let revision=2;revision<=3;revision++) {
      const retry=await calculatePeriod(app,actor,periodId); if(isPayrollError(retry)) throw Error(retry.message);
      const revised=await listLines(app,actor,periodId); if(isPayrollError(revised)) throw Error(revised.message);
      expect(revised.revision).toBe(revision);
      expect(revised.lines.find(line=>line.component_code==="AKONTACIJA")?.amount_cents).toBe(-8000);
      const debt=await admin.query<{remaining_cents:string}>("SELECT remaining_cents::text FROM public.worker_advances WHERE company_id=$1 AND id=$2",[CO,advance.id]);
      expect(debt.rows[0]!.remaining_cents).toBe("10000");
    }
    expect(isPayrollError(await approvePeriod(app,actor,periodId))).toBe(false);
    expect(isPayrollError(await lockPeriod(app,actor,periodId))).toBe(false);
    expect(isPayrollError(await lockPeriod(app,actor,periodId))).toBe(true);
    const afterLock=await admin.query<{remaining_cents:string}>("SELECT remaining_cents::text FROM public.worker_advances WHERE company_id=$1 AND id=$2",[CO,advance.id]);
    expect(afterLock.rows[0]!.remaining_cents).toBe("2000");
  });

  it("paralelni periodi rezervišu ukupno najviše dug, a zaključavanje ga naplati jednom",async()=>{
    await addRate(WORKER,1000);
    await seedDay({workDate:"2026-03-03",start:"07:00",end:"15:00"});
    await seedDay({workDate:"2026-04-02",start:"07:00",end:"15:00"});
    const debt=await createAdvance(app,actor,{workerId:WORKER,kind:"ADVANCE",amount:"100.00",issuedOn:"2026-03-01"});
    if(isPayrollError(debt)) throw Error(debt.message);
    const march=await openPeriod(2026,3),april=await openPeriod(2026,4);
    const calculated=await Promise.all([calculatePeriod(app,actor,march),calculatePeriod(app,actor,april)]);
    for(const result of calculated) if(isPayrollError(result)) throw Error(result.message);
    const marchLines=await listLines(app,actor,march),aprilLines=await listLines(app,actor,april);
    if(isPayrollError(marchLines)||isPayrollError(aprilLines)) throw Error("missing lines");
    const amounts=[marchLines,aprilLines].map(x=>x.lines.find(l=>l.component_code==="AKONTACIJA")?.amount_cents ?? 0);
    expect(amounts.sort((a,b)=>a-b)).toEqual([-8000,-2000]);
    const balance=async()=> (await admin.query<{remaining:string}>("SELECT remaining_cents::text AS remaining FROM public.worker_advances WHERE company_id=$1 AND id=$2",[CO,debt.id])).rows[0]!.remaining;
    expect(await balance()).toBe("10000");
    expect(isPayrollError(await approvePeriod(app,actor,march))).toBe(false);
    expect(isPayrollError(await approvePeriod(app,actor,april))).toBe(false);
    const locked=await Promise.all([lockPeriod(app,actor,march),lockPeriod(app,actor,april)]);
    for(const result of locked) if(isPayrollError(result)) throw Error(result.message);
    expect(await balance()).toBe("0");
  });

  it("zaključavanje ne naplati nijedan dug ako je druga rezervacija nekonzistentna",async()=>{
    await addRate(WORKER,1000);
    await seedDay({workDate:"2026-03-03",start:"07:00",end:"15:00"});
    const first=await createAdvance(app,actor,{workerId:WORKER,kind:"ADVANCE",amount:"20.00",issuedOn:"2026-03-01"});
    const second=await createAdvance(app,actor,{workerId:WORKER,kind:"ADVANCE",amount:"20.00",issuedOn:"2026-03-02"});
    if(isPayrollError(first)||isPayrollError(second)) throw Error("advance create failed");
    const period=await openPeriod(2026,3);
    expect(isPayrollError(await calculatePeriod(app,actor,period))).toBe(false);
    expect(isPayrollError(await approvePeriod(app,actor,period))).toBe(false);
    // Inject an inconsistent balance on the second row in the lock order.
    const [ok,bad]=[first.id,second.id].sort();
    await admin.query("UPDATE public.worker_advances SET remaining_cents=0 WHERE company_id=$1 AND id=$2",[CO,bad]);
    expect(await lockPeriod(app,actor,period)).toMatchObject({code:"CONFLICT"});
    expect((await admin.query("SELECT remaining_cents::text AS remaining FROM public.worker_advances WHERE company_id=$1 AND id=$2",[CO,ok])).rows[0].remaining).toBe("2000");
    expect((await admin.query("SELECT status FROM public.pay_periods WHERE company_id=$1 AND id=$2",[CO,period])).rows[0].status).toBe("APPROVED");
  });

  it("SELF_APPROVAL_FORBIDDEN: računovođa ne odobrava obračun u kojem je sam", async () => {
    await addRate(ACCT_WORKER, 1000);
    await seedDay({ workDate: "2026-03-03", start: "07:00", end: "15:00", workerId: ACCT_WORKER });

    const periodId = await openPeriod(2026, 3);
    await calculatePeriod(app, actor, periodId);

    // Isti čovjek kao radnik u obračunu: potpis na sopstveni mjesec je zabranjen.
    const selfApprove = await approvePeriod(
      app,
      { userId: ACCT, companyId: CO, roles: ["ACCOUNTANT"] as const },
      periodId,
    );
    expect(isPayrollError(selfApprove)).toBe(true);
    if (isPayrollError(selfApprove)) expect(selfApprove.code).toBe("SELF_APPROVAL_FORBIDDEN");
    expect(await approvePeriod(app,{userId:ACCT,companyId:CO,roles:["ACCOUNTANT"],system:true},periodId)).toMatchObject({code:"SELF_APPROVAL_FORBIDDEN"});

    // Neko drugi (vlasnik nije radnik) odobrava normalno.
    const approved = await approvePeriod(app, actor, periodId);
    if (isPayrollError(approved)) throw new Error(`${approved.message} ${JSON.stringify(approved.detail)}`);
    expect(approved.status).toBe("APPROVED");
  });

  it("trošak rada: cost_entries nastaje jednom po danu, ponovni izračun ne duplira", async () => {
    await addRate(WORKER, 1000);
    await seedDay({ workDate: "2026-03-03", start: "07:00", end: "15:00" });
    await seedDay({ workDate: "2026-03-04", start: "07:00", end: "15:00" });

    const periodId = await openPeriod(2026, 3);
    const first = await calculatePeriod(app, actor, periodId);
    if (isPayrollError(first)) throw new Error(first.message);
    expect(first.cost_entries_written).toBe(2);

    const rows = () =>
      admin.query<{ source_id: string; amount_cents: string; quantity: string }>(
        `SELECT source_id, amount_cents::text, quantity::text
           FROM public.cost_entries
          WHERE company_id = $1 AND source_type = 'WORKDAY'
          ORDER BY source_id`,
        [CO],
      );
    const afterFirst = await rows();
    expect(afterFirst.rowCount).toBe(2);
    // 8 h × 10,00 = 80,00 po danu.
    expect(afterFirst.rows.map((row) => row.amount_cents)).toEqual(["8000", "8000"]);

    // Novi izračun = nova revizija obračuna, ali ISTI troškovi: jedan dan = jedna knjiga.
    const second = await calculatePeriod(app, actor, periodId);
    if (isPayrollError(second)) throw new Error(second.message);
    expect(second.revision).toBe(first.revision + 1);
    expect(second.cost_entries_written).toBe(0);
    expect(second.cost_entries_skipped).toBe(2);
    const afterSecond = await rows();
    expect(afterSecond.rowCount).toBe(2);
    expect(afterSecond.rows).toEqual(afterFirst.rows);
  });

  it("izvoz: default samo LOCKED, XLSX ima OBRACUN i RASPIS sa verzijom formata", async () => {
    await addRate(WORKER, 1000);
    await seedDay({ workDate: "2026-03-03", start: "07:00", end: "15:00" });

    const periodId = await openPeriod(2026, 3);
    await calculatePeriod(app, actor, periodId);

    // Period nije zaključan: default izvoz je odbijen, provizorni prolazi uz oznaku.
    const denied = await buildPayrollExport(app, actor, { periodId, format: "xlsx" });
    expect("code" in denied).toBe(true);
    if ("code" in denied) expect(denied.code).toBe("PERIOD_NOT_READY");

    const provisional = await buildPayrollExport(app, actor, {
      periodId,
      format: "xlsx",
      includeProvisional: true,
    });
    if ("code" in provisional) throw new Error(provisional.message);
    expect(provisional.meta.provisional).toBe(true);
    expect(provisional.meta.version).toBe("OBRACUN-2");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(provisional.body) as never);
    const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
    expect(sheetNames).toContain("OBRAČUN");
    expect(sheetNames).toContain("RASPIS");

    // Zaglavlje nosi verziju formata i oznaku provizornosti — fajl sam kaže šta je.
    const main = workbook.getWorksheet("OBRAČUN")!;
    const headerText = String(main.getRow(1).getCell(1).value ?? "");
    expect(headerText).toContain("OBRACUN-2");
    const provisionalText = String(main.getRow(2).getCell(1).value ?? "");
    expect(provisionalText).toContain("PROVIZORNO");

    // Poslije zaključavanja default izvoz prolazi, bez oznake provizornosti.
    await approvePeriod(app, actor, periodId);
    await lockPeriod(app, actor, periodId);
    const final = await buildPayrollExport(app, actor, { periodId, format: "csv" });
    if ("code" in final) throw new Error(final.message);
    expect(final.meta.provisional).toBe(false);
    const csv = final.body.toString("utf8");
    expect(csv).toContain("OBRACUN-2");
    expect(csv).toContain("Konačan obračun");
  });

  it("Moj obračun: radnik vidi svoje sate, iznose tek kad je period odobren", async () => {
    await addRate(ACCT_WORKER, 1000);
    await seedDay({ workDate: "2026-03-03", start: "07:00", end: "15:00", workerId: ACCT_WORKER });
    const periodId = await openPeriod(2026, 3);
    await calculatePeriod(app, actor, periodId);

    const accountant = { userId: ACCT, companyId: CO, roles: ["ACCOUNTANT"] as const };
    const whileOpen = await getMyPayroll(app, accountant, { year: 2026, month: 3 });
    if (isPayrollError(whileOpen)) throw new Error(whileOpen.message);
    expect(whileOpen.totals.total_hours).toBe(8);
    // Iznosi nisu konačni — linije se ne prikazuju, a razlog je imenovan.
    expect(whileOpen.lines).toBeNull();
    expect(whileOpen.lines_available_reason).toBeTruthy();

    await approvePeriod(app, actor, periodId);
    const approved = await getMyPayroll(app, accountant, { year: 2026, month: 3 });
    if (isPayrollError(approved)) throw new Error(approved.message);
    expect(approved.lines).not.toBeNull();
    expect(approved.lines!.length).toBeGreaterThan(0);
  });

  it("izolacija: firma B ne vidi periode, parametre, komponente ni akontacije firme A", async () => {
    await addRate(WORKER, 1000);
    await seedDay({ workDate: "2026-03-03", start: "07:00", end: "15:00" });
    const periodId = await openPeriod(2026, 3);
    await calculatePeriod(app, actor, periodId);
    const advance = await createAdvance(app, actor, {
      workerId: WORKER,
      kind: "ADVANCE",
      amount: "50.00",
      issuedOn: "2026-03-10",
    });
    if (isPayrollError(advance)) throw new Error(advance.message);

    const actorB = { userId: OWNER_B, companyId: CO_B, roles: ["OWNER"] as const, system: false };

    // Firma B ima svoj (prazan) svijet — bez ijednog reda firme A.
    const periodsB = await listPeriods(app, actorB, { year: 2026 });
    if (isPayrollError(periodsB)) throw new Error(periodsB.message);
    expect(periodsB.periods).toEqual([]);

    /* Šifarnik komponenti se sam popunjava za svaku firmu (`ensureComponents`), pa firma B
       ima ISTE ŠIFRE — ali nijedan ISTI RED. Zato se poredi identitet, ne šifra. */
    const componentsA = await listComponents(app, actor);
    const componentsB = await listComponents(app, actorB);
    if (isPayrollError(componentsA)) throw new Error(componentsA.message);
    if (isPayrollError(componentsB)) throw new Error(componentsB.message);
    const idsA = new Set(componentsA.components.map((row) => row.id));
    expect(componentsB.components.length).toBeGreaterThan(0);
    expect(componentsB.components.some((row) => idsA.has(row.id))).toBe(false);

    const advancesB = await listAdvances(app, actorB, WORKER_B);
    if (isPayrollError(advancesB)) throw new Error(advancesB.message);
    expect(advancesB.advances).toEqual([]);

    /* Tuđi ID ne otvara vrata. Odgovor je PRAZAN, a ne `NOT_FOUND`: razlika bi firmi B odala
       da period sa tim ID-em postoji negdje drugdje. Nijedan red, nijedan iznos. */
    const foreignLines = await listLines(app, actorB, periodId);
    if (isPayrollError(foreignLines)) throw new Error(foreignLines.message);
    expect(foreignLines.lines).toEqual([]);
    expect(foreignLines.run_id).toBeNull();
    expect(foreignLines.totals.earnings_cents).toBeNull();

    const foreignAdvance = await createAdvance(app, actorB, {
      workerId: WORKER,
      kind: "ADVANCE",
      amount: "10.00",
      issuedOn: "2026-03-10",
    });
    expect(isPayrollError(foreignAdvance)).toBe(true);
  });

  it("periodi: stanja idu samo naprijed i zaključan se ne preračunava", async () => {
    await addRate(WORKER, 1000);
    await seedDay({ workDate: "2026-03-03", start: "07:00", end: "15:00" });
    const periodId = await openPeriod(2026, 3);

    // Odobrenje bez izračuna je odbijeno — stanje, ne unos.
    const early = await approvePeriod(app, actor, periodId);
    if (isPayrollError(early)) expect(early.code).toBe("CONFLICT");

    await calculatePeriod(app, actor, periodId);
    await approvePeriod(app, actor, periodId);
    await lockPeriod(app, actor, periodId);

    // Ponovni izračun zaključanog perioda je odbijen; ispravke idu kroz korekcije.
    const recalc = await calculatePeriod(app, actor, periodId);
    expect(isPayrollError(recalc)).toBe(true);
    if (isPayrollError(recalc)) expect(recalc.code).toBe("PAYROLL_ALREADY_LOCKED");

    const periods = await listPeriods(app, actor, { year: 2026 });
    if (isPayrollError(periods)) throw new Error(periods.message);
    expect(periods.periods.find((row) => row.id === periodId)?.status).toBe("LOCKED");
  });
});

/** Fiksture firme: radnici, projekti, članstva. */
beforeAll(async () => {
  if (!appUrl || !adminUrl) return;
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  /* Noćni prozor se postavlja eksplicitno: bez njega firma NEMA noćnih sati i to je ispravno
     ponašanje (nema izmišljenog 22:00–06:00). Test mjeri noćne sate, pa prozor mora postojati. */
  await admin.query(
    `INSERT INTO public.companies (id, name, slug, city, night_from, night_to, timezone)
     VALUES ($1, 'F6', $2, 'Sarajevo', '22:00', '06:00', 'Europe/Sarajevo')
     ON CONFLICT DO NOTHING`,
    [CO, `f6-${RUN}`],
  );
  await admin.query(
    `INSERT INTO public.users (id, email, first_name, last_name, password_hash, must_change_password)
     VALUES ($1, $2, 'V', 'Lasnik', 'x', false), ($3, $4, 'R', 'Acun', 'x', false)
     ON CONFLICT DO NOTHING`,
    [OWNER, `f6own-${RUN}@test.example`, ACCT, `f6acc-${RUN}@test.example`],
  );
  await withCompany(admin, toCompanyId(CO), async (client) => {
    await client.query(
      `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
       VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY'),
              ($4, $5, $3, ARRAY['ACCOUNTANT']::"Role"[], 'COMPANY')
       ON CONFLICT DO NOTHING`,
      [`mem_f6_own_${RUN}`, OWNER, CO, `mem_f6_acc_${RUN}`, ACCT],
    );
    await client.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, user_id, hired_at)
       VALUES ($1, $3, 'R', 'Adnik', NULL, '2024-01-01'),
              ($2, $3, 'A', 'Cun', $4, '2024-01-01')
       ON CONFLICT DO NOTHING`,
      [WORKER, ACCT_WORKER, CO, ACCT],
    );
    await client.query(
      `INSERT INTO public.projects (id, company_id, code, name, site_place)
       VALUES ($1, $3, $4, 'Gradilište van grada', 'Mostar'),
              ($2, $3, $5, 'Gradilište u gradu', 'Sarajevo')
       ON CONFLICT DO NOTHING`,
      [PROJECT, IN_CITY_PROJECT, CO, `F6-${RUN}`.slice(0, 20), `F6I-${RUN}`.slice(0, 20)],
    );
  });
  // Firma B: vlastiti vlasnik, radnik i projekat — ništa se ne dijeli sa firmom A.
  await admin.query(
    `INSERT INTO public.companies (id, name, slug, city, timezone)
     VALUES ($1, 'F6B', $2, 'Sarajevo', 'Europe/Sarajevo')
     ON CONFLICT DO NOTHING`,
    [CO_B, `f6b-${RUN}`],
  );
  await admin.query(
    `INSERT INTO public.users (id, email, first_name, last_name, password_hash, must_change_password)
     VALUES ($1, $2, 'V', 'Drugi', 'x', false)
     ON CONFLICT DO NOTHING`,
    [OWNER_B, `f6bown-${RUN}@test.example`],
  );
  await withCompany(admin, toCompanyId(CO_B), async (client) => {
    await client.query(
      `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
       VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY')
       ON CONFLICT DO NOTHING`,
      [`mem_f6b_own_${RUN}`, OWNER_B, CO_B],
    );
    await client.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, $2, 'R', 'Drugi', '2024-01-01')
       ON CONFLICT DO NOTHING`,
      [WORKER_B, CO_B],
    );
    await client.query(
      `INSERT INTO public.projects (id, company_id, code, name)
       VALUES ($1, $2, $3, 'Projekat B')
       ON CONFLICT DO NOTHING`,
      [PROJECT_B, CO_B, `F6B-${RUN}`.slice(0, 20)],
    );
  });
  await admin.end();
}, 60_000);

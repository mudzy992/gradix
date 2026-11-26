import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import nodemailer from "nodemailer";
import { listActiveCompanyIds } from "./company-ids";
import { monthlyReportPdf } from "./monthly-report-pdf";
import type { JobLogger } from "./jobs";

export type MonthlyMail = { recipients: string[]; subject: string; pdf: Buffer; messageId: string };
type Sender = (message: MonthlyMail) => Promise<void>;
export function smtpSender(env: NodeJS.ProcessEnv): Sender | null {
  if (!env.SMTP_HOST?.trim() || !env.SMTP_FROM?.trim()) return null;
  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT_INVALID");
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) throw new Error("SMTP_AUTH_INCOMPLETE");
  const auth = env.SMTP_USER && env.SMTP_PASSWORD ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined;
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: env.SMTP_SECURE === "true",
    requireTLS: Boolean(auth), connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    ...(auth ? {auth} : {}) });
  return async message => {
    const result = await transport.sendMail({ from: env.SMTP_FROM, bcc: message.recipients, subject: message.subject,
      text: "Mjesečni pregled je u PDF prilogu.", messageId: message.messageId,
      attachments: [{ filename: "mjesecni-pregled.pdf", content: message.pdf, contentType: "application/pdf" }] });
    if (result.rejected.length || result.accepted.length !== message.recipients.length) throw new Error("SMTP_RECIPIENT_REJECTED");
  };
}

async function ensureNotice(client: PoolClient, companyId: string, key: string, period: string) {
  const notification = await client.query<{id:string}>(`INSERT INTO public.notifications
    (id,company_id,role_target,kind,title,body,href,severity,dedupe_key)
    VALUES ($1,$2,'OWNER','report.ready','Mjesečni izvještaj',$3,'/pregled','INFO',$4)
    ON CONFLICT (company_id,dedupe_key) DO UPDATE SET dedupe_key=excluded.dedupe_key RETURNING id`,
  [`ntf_${randomUUID()}`, companyId, `Pregled za ${period}.`, key]);
  const id = notification.rows[0]!.id;
  await client.query(`INSERT INTO public.notification_deliveries(id,company_id,notification_id,channel,status,attempts,sent_at)
    VALUES ($1,$2,$3,'IN_APP','SENT',1,clock_timestamp()) ON CONFLICT (notification_id,channel) DO NOTHING`, [`ntd_${randomUUID()}`,companyId,id]);
  return id;
}

/** Firme i njihove podaci se čitaju zasebno pod RLS; jedan ključ po firmi i mjesecu. */
export async function runScheduledReports(pool: Pool, options: { logger: JobLogger; now?: Date; onlyCompanyId?: string; send?: Sender | null; env?: NodeJS.ProcessEnv }) {
  const send = options.send === undefined ? smtpSender(options.env ?? process.env) : options.send;
  const outcome = { companies:0, sent:0, blocked:0, duplicate:0, failed:0, indeterminate:0 };
  for (const companyId of await listActiveCompanyIds(pool, options.onlyCompanyId)) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); await client.query("SELECT set_config('app.company_id',$1,true)",[companyId]);
      const company = await client.query<{name:string;currency:string;enabled:boolean;recipients:string[]|null;from_date:string;to_date:string}>(
        `SELECT name,currency,monthly_report_enabled AS enabled,monthly_report_recipients AS recipients,
          (date_trunc('month',($2::timestamptz AT TIME ZONE timezone))-interval '1 month')::date::text AS from_date,
          (date_trunc('month',($2::timestamptz AT TIME ZONE timezone))-interval '1 day')::date::text AS to_date
        FROM public.companies WHERE id=$1 AND is_active`,[companyId,options.now ?? new Date()]);
      const c=company.rows[0]; if (!c?.enabled) { await client.query("COMMIT"); continue; }
      const key=`monthly-report:${c.from_date}`, period=c.from_date.slice(0,7);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2,0))",[companyId,key]);
      const job=await client.query<{id:string;status:string}>(`INSERT INTO public.report_jobs
        (id,company_id,kind,period_from,period_to,dedupe_key,format)
        VALUES ($1,$2,'MONTHLY_SUMMARY',$3,$4,$5,'PDF')
        ON CONFLICT (company_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE SET dedupe_key=excluded.dedupe_key
        RETURNING id,status`,[`rpt_${randomUUID()}`,companyId,c.from_date,c.to_date,key]);
      if(job.rows[0]!.status === "DONE") {outcome.duplicate++;await client.query("COMMIT");continue;}
      const notice=await ensureNotice(client,companyId,key,period); outcome.companies++;
      // Once an attempt starts its outcome may be unknown (process crash or SMTP timeout).
      // Never retry it automatically: SMTP acceptance and a database commit cannot be atomic.
      const delivery = await client.query<{status:string;attempts:number}>(
        "SELECT status,attempts FROM public.notification_deliveries WHERE company_id=$1 AND notification_id=$2 AND channel='EMAIL'",
        [companyId,notice]);
      if (delivery.rows[0]?.status === "SENT") {
        outcome.duplicate++; await client.query("COMMIT"); continue;
      }
      if ((delivery.rows[0]?.attempts ?? 0) > 0) {
        outcome.indeterminate++;
        options.logger.warn("reports.scheduled: SMTP ishod zahtijeva ručnu provjeru", { companyId, period });
        await client.query("COMMIT"); continue;
      }
      const recipients=(c.recipients ?? []).map(x=>x.trim()).filter(Boolean);
      const valid=recipients.length>0 && recipients.length<=50 && recipients.every(x=>/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(x));
      let status:"BLOCKED_NO_PROVIDER"|"FAILED"|"SENT" = !send ? "BLOCKED_NO_PROVIDER" : !valid ? "FAILED" : "SENT";
      if(status === "SENT" && send) {
        const totals=await client.query<{cents:string;hours:string}>(`SELECT
          (SELECT coalesce(sum(e.amount_cents),0)::text FROM public.cost_entries e
            WHERE e.company_id=$1 AND e.status='POSTED' AND e.occurred_on BETWEEN $2::date AND $3::date) AS cents,
          (SELECT coalesce(sum(extract(epoch FROM (w.ended_at-w.started_at))/3600),0)::numeric(16,3)::text
             FROM public.work_entries w JOIN public.workdays d ON d.company_id=w.company_id AND d.id=w.workday_id
            WHERE w.company_id=$1 AND w.kind='WORK' AND w.end_state='KNOWN_END' AND w.ended_at IS NOT NULL
              AND d.approval_status IN ('LOCKED','FOREMAN_CONFIRMED') AND d.work_date BETWEEN $2::date AND $3::date) AS hours`,[companyId,c.from_date,c.to_date]);
        const cents=BigInt(totals.rows[0]!.cents); const abs=cents<0n?-cents:cents;
        const pdf=monthlyReportPdf([c.name,"MJESECNI PREGLED",`Period: ${c.from_date} - ${c.to_date}`,
          `Knjizeni trosak: ${cents<0n?"-":""}${abs/100n}.${String(abs%100n).padStart(2,"0")} ${c.currency}`,
          `Potvrdjeni sati: ${totals.rows[0]!.hours}`,`Generisao: automatski worker; ${new Date().toISOString()}`]);
        // Commit the attempt before talking to SMTP; a crash now requires manual reconciliation,
        // but a later scheduled run cannot send a duplicate. A stable Message-ID alone is not dedupe.
        await client.query(`INSERT INTO public.notification_deliveries(id,company_id,notification_id,channel,status,attempts,last_error)
          VALUES ($1,$2,$3,'EMAIL','PENDING',1,'Ishod SMTP pokušaja nije potvrđen; potrebna je provjera.')
          ON CONFLICT (notification_id,channel) DO UPDATE SET status='PENDING',attempts=1,
            last_error='Ishod SMTP pokušaja nije potvrđen; potrebna je provjera.',sent_at=NULL`,
          [`ntd_${randomUUID()}`,companyId,notice]);
        await client.query("COMMIT");
        try { await send({recipients,subject:`Mjesečni pregled ${period}`,pdf,
          messageId:`<${createHash("sha256").update(companyId+key).digest("hex")}@gradix.local>`}); }
        catch { status="FAILED"; }
        await client.query("BEGIN"); await client.query("SELECT set_config('app.company_id',$1,true)",[companyId]);
      }
      await client.query(`INSERT INTO public.notification_deliveries(id,company_id,notification_id,channel,status,attempts,last_error,sent_at)
        VALUES ($1,$2,$3,'EMAIL',$4,$5,$6,CASE WHEN $4='SENT' THEN clock_timestamp() ELSE NULL END)
        ON CONFLICT (notification_id,channel) DO UPDATE SET status=excluded.status,attempts=greatest(public.notification_deliveries.attempts,excluded.attempts),
          last_error=excluded.last_error,sent_at=excluded.sent_at`,[`ntd_${randomUUID()}`,companyId,notice,status,status === "BLOCKED_NO_PROVIDER" || !valid ? 0 : 1,
          status === "BLOCKED_NO_PROVIDER" ? "SMTP nije podešen." : status === "FAILED" ? "Isporuka nije potvrđena; potrebna je ručna provjera prije ponovnog slanja." : null]);
      if(status === "SENT") {await client.query("UPDATE public.report_jobs SET status='DONE',completed_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[companyId,job.rows[0]!.id]);outcome.sent++;}
      else if(status === "BLOCKED_NO_PROVIDER") outcome.blocked++; else outcome.failed++;
      await client.query("COMMIT");
    } catch(error) {await client.query("ROLLBACK").catch(()=>undefined); throw error;} finally {client.release();}
  }
  options.logger.info("reports.scheduled",{...outcome}); return outcome;
}

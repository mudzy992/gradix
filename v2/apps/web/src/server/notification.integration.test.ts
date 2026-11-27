/**
 * F0.4 — inbox na pravoj bazi. Provjerava četiri stvari koje su u spec 12 §1.2 pravila,
 * a ne ukras:
 *   1. `dedupe_key` po STVARI: isti posao 50 puta → jedno obavještenje (`DUPLICATE`);
 *   2. in-app isporuka je `SENT` odmah (radi bez SMTP-a), a email bez provajdera je
 *      `BLOCKED_NO_PROVIDER` — poruka ostaje, ne nestaje;
 *   3. tuđe obavještenje se NE može označiti kao pročitano i ne vidi se u listi;
 *   4. retencija briše samo po pravilu (90 d / 1 g / 2 g za `CRITICAL`).
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  NOTIFICATION_RETENTION_SQL,
  listNotifications,
  markRead,
  notify,
  unreadCount,
} from "./notification-service";
import { deliverNotifications } from "../../../worker/src/notifications-deliver";
import { smtpConfigured } from "../../../worker/src/notifications-deliver";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_nt_${RUN}`;
const OTHER = `cmp_ntx_${RUN}`;
const OWNER = `usr_nt_owner_${RUN}`;
const WORKER = `usr_nt_worker_${RUN}`;

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describeDb("F0.4 obavještenja (PostgreSQL)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 2 });

  beforeAll(async () => {
    for (const [id, slug] of [[CO, `nt-${RUN}`], [OTHER, `ntx-${RUN}`]] as const) {
      await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'NT', $2)", [id, slug]);
    }
    for (const id of [OWNER, WORKER]) {
      await admin.query(
        `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
         VALUES ($1, $2, 'x', 'N', 'T', false)`,
        [id, `${id}@test.example`],
      );
    }
  }, 60_000);

  afterAll(async () => {
    await admin.query("DELETE FROM public.notification_deliveries WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.notifications WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.companies WHERE id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.users WHERE id = ANY($1)", [[OWNER, WORKER]]);
    await admin.end();
    await app.end();
  });

  it("isti dedupe_key drugi put ne pravi novo obavještenje", async () => {
    const first = await notify(app, CO, {
      kind: "obligation.expiring",
      title: "Ljekarski istječe za 7 dana",
      href: "/ured/rokovi?stanje=uskoro",
      severity: "WARN",
      userId: WORKER,
      sourceType: "obligation",
      sourceId: "obl_1",
      dedupeKey: `obligation:obl_1:7`,
    });
    expect(first.outcome).toBe("CREATED");

    const second = await notify(app, CO, {
      kind: "obligation.expiring",
      title: "Ljekarski istječe za 7 dana",
      href: "/ured/rokovi?stanje=uskoro",
      userId: WORKER,
      dedupeKey: `obligation:obl_1:7`,
    });
    expect(second.outcome).toBe("DUPLICATE");

    const rows = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.notifications WHERE company_id = $1 AND dedupe_key = $2",
      [CO, "obligation:obl_1:7"],
    );
    expect(rows.rows[0]?.n).toBe(1);

    // In-app kanal je SENT odmah: inbox radi bez SMTP-a.
    const delivery = await admin.query<{ status: string }>(
      `SELECT d.status FROM public.notification_deliveries d
         JOIN public.notifications n ON n.id = d.notification_id AND n.company_id = d.company_id
        WHERE n.company_id = $1 AND n.dedupe_key = $2 AND d.channel = 'IN_APP'`,
      [CO, "obligation:obl_1:7"],
    );
    expect(delivery.rows[0]?.status).toBe("SENT");
  });

  it("bez primaoca ili sa href bez „/“ obavještenje se odbija", async () => {
    const noTarget = await notify(app, CO, {
      kind: "system",
      title: "x",
      href: "/ured",
      dedupeKey: `system:${RUN}:1`,
    });
    expect(noTarget.outcome).toBe("VALIDATION_FAILED");

    const badHref = await notify(app, CO, {
      kind: "system",
      title: "x",
      href: "https://napolje.example",
      userId: WORKER,
      dedupeKey: `system:${RUN}:2`,
    });
    expect(badHref.outcome).toBe("VALIDATION_FAILED");
  });

  it("role_target stiže svima s tom rolom; tuđe se ne vidi ni ne označava", async () => {
    await notify(app, CO, {
      kind: "system",
      title: "Svi šefovi",
      href: "/ured/radni-dani",
      roleTarget: "SITE_SUPERVISOR",
      dedupeKey: `system:${RUN}:role`,
    });

    const asForeman = await listNotifications(app, {
      companyId: CO,
      userId: WORKER,
      roles: ["SITE_SUPERVISOR"], scope: "COMPANY" as const, projectIds: null,
    });
    expect(asForeman.map((row) => row.title)).toContain("Svi šefovi");

    const asWorker = await listNotifications(app, { companyId: CO, userId: WORKER, roles: ["WORKER"], scope: "COMPANY" as const, projectIds: null });
    expect(asWorker.map((row) => row.title)).not.toContain("Svi šefovi");

    // Tuđe lično obavještenje: OWNER ga ne vidi i ne može ga označiti.
    const ownerInbox = await listNotifications(app, { companyId: CO, userId: OWNER, roles: ["OWNER"], scope: "COMPANY" as const, projectIds: null });
    expect(ownerInbox.map((row) => row.title)).not.toContain("Ljekarski istječe za 7 dana");

    const workerInbox = await listNotifications(app, { companyId: CO, userId: WORKER, roles: ["WORKER"], scope: "COMPANY" as const, projectIds: null });
    const personal = workerInbox.find((row) => row.title === "Ljekarski istječe za 7 dana")!;
    const stolen = await markRead(app, {
      companyId: CO,
      userId: OWNER,
      roles: ["OWNER"], scope: "COMPANY" as const, projectIds: null,
      notificationId: personal.id,
    });
    expect(stolen).toBe(0);

    const own = await markRead(app, { companyId: CO, userId: WORKER, roles: ["WORKER"], scope: "COMPANY" as const, projectIds: null, notificationId: personal.id });
    expect(own).toBe(1);
  });

  it("druga firma ne vidi ništa", async () => {
    expect(await unreadCount(app, { companyId: OTHER, userId: WORKER, roles: ["WORKER"], scope: "COMPANY" as const, projectIds: null })).toBe(0);
    const foreign = await listNotifications(app, { companyId: OTHER, userId: WORKER, roles: ["WORKER"], scope: "COMPANY" as const, projectIds: null });
    expect(foreign).toEqual([]);
  });

  it("notifications.deliver: email bez SMTP-a je BLOCKED_NO_PROVIDER, ne FAILED", async () => {
    expect(smtpConfigured({} as NodeJS.ProcessEnv)).toBe(false);

    const outcome = await deliverNotifications(app, { companyId: CO, logger, env: {} as NodeJS.ProcessEnv });
    expect(outcome.processed).toBeGreaterThan(0);

    const email = await admin.query<{ status: string; last_error: string | null }>(
      `SELECT d.status, d.last_error FROM public.notification_deliveries d
        WHERE d.company_id = $1 AND d.channel = 'EMAIL'`,
      [CO],
    );
    expect(email.rows.length).toBeGreaterThan(0);
    for (const row of email.rows) {
      expect(row.status).toBe("BLOCKED_NO_PROVIDER");
      expect(row.last_error).toContain("SMTP");
    }

    // Ponovni prolaz ne pravi duple redove isporuke (unikatan (notification_id, channel)).
    const before = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.notification_deliveries WHERE company_id = $1",
      [CO],
    );
    await deliverNotifications(app, { companyId: CO, logger, env: {} as NodeJS.ProcessEnv });
    const after = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.notification_deliveries WHERE company_id = $1",
      [CO],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it("retencija: pročitano 90 d, neproučeno 1 g, CRITICAL 2 g", async () => {
    // Tri „stare“ poruke, jedina razlika je starost i stanje čitanja.
    await admin.query(
      `INSERT INTO public.notifications
         (id, company_id, user_id, kind, title, href, severity, dedupe_key, created_at, read_at)
       VALUES
         ($1, $3, $4, 'system', 'star pročitan', '/ured', 'INFO', $5, now() - interval '100 days', now() - interval '95 days'),
         ($2, $3, $4, 'system', 'star nepročitan', '/ured', 'INFO', $6, now() - interval '400 days', NULL)`,
      [`ntf_old_a_${RUN}`, `ntf_old_b_${RUN}`, CO, WORKER, `old:${RUN}:a`, `old:${RUN}:b`],
    );
    await admin.query(
      `INSERT INTO public.notifications (id, company_id, user_id, kind, title, href, severity, dedupe_key, created_at)
       VALUES ($1, $2, $3, 'system', 'kritičan ali mlad', '/ured', 'CRITICAL', $4, now() - interval '400 days')`,
      [`ntf_old_c_${RUN}`, CO, WORKER, `old:${RUN}:c`],
    );

    await admin.query(NOTIFICATION_RETENTION_SQL);

    const left = await admin.query<{ title: string }>(
      "SELECT title FROM public.notifications WHERE company_id = $1 AND dedupe_key LIKE $2 ORDER BY title",
      [CO, `old:${RUN}%`],
    );
    expect(left.rows.map((row) => row.title)).toEqual(["kritičan ali mlad"]);
  });
});

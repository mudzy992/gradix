/**
 * Registracija priloga mora doći do INSERT-a na pravoj bazi.
 * Stari bug: 10 kolona, 9 izraza → PG „INSERT has more target columns than expressions“.
 * Storage se mock-uje da CI (bez MinIO-a) ne stane prije INSERT-a.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { companyId } from "@gradix/db";

vi.mock("./storage", async () => {
  const actual = await vi.importActual<typeof import("./storage")>("./storage");
  return {
    ...actual,
    storageConfig: () => ({
      configured: true as const,
      client: {} as never,
      presignClient: {} as never,
      bucket: "gradix-stg",
      publicEndpoint: "https://minio.test.example",
    }),
    presignUpload: async () => ({
      url: "https://minio.test.example/upload",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  };
});

const { registerAttachment, isServiceError } = await import("./obligation-service");

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_att_${RUN}`;
const USER = `usr_att_${RUN}`;
const WRK = `wrk_att_${RUN}`;
const TYPE = `obt_att_${RUN}`;
const OBL = `obl_att_${RUN}`;

describeDb("obligation attachment register (PostgreSQL)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 2 });

  beforeAll(async () => {
    await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'Att', $2)", [CO, `att-${RUN}`]);
    await admin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, 'att-${RUN}@test.example', 'x', 'A', 'T', false)`,
      [USER],
    );
    await admin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, $2, 'Rad', 'Att', '2024-01-01')`,
      [WRK, CO],
    );
    await admin.query(
      `INSERT INTO public.obligation_types (id, company_id, code, label, entity_kind)
       VALUES ($1, $2, $3, 'Att tip', 'WORKER')`,
      [TYPE, CO, `AT${RUN}`.toUpperCase().slice(0, 40)],
    );
    await admin.query(
      `INSERT INTO public.obligations (id, company_id, type_id, worker_id, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [OBL, CO, TYPE, WRK, USER],
    );
  }, 60_000);

  afterAll(async () => {
    await admin.query("DELETE FROM public.obligation_attachments WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.obligations WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.obligation_types WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.workers WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.companies WHERE id = $1", [CO]);
    await admin.query("DELETE FROM public.users WHERE id = $1", [USER]);
    await admin.end();
    await app.end();
  });

  it("registerAttachment upisuje pending red (ne pada na columns≠expressions)", async () => {
    const head = new TextEncoder().encode("%PDF-1.7\nsinteticki\n");
    const result = await registerAttachment(app, companyId(CO), { userId: USER, roles: ["OWNER"] }, OBL, {
      fileName: "sinteticki.pdf",
      sizeBytes: head.byteLength,
      sha256: "c".repeat(64),
      head,
    });
    expect(isServiceError(result)).toBe(false);
    if (isServiceError(result)) return;
    expect(result.attachment.status).toBe("pending");
    const row = await admin.query<{ n: string; created_by: string }>(
      `SELECT count(*)::text AS n, max(created_by) AS created_by
         FROM public.obligation_attachments WHERE company_id = $1 AND obligation_id = $2 AND status = 'pending'`,
      [CO, OBL],
    );
    expect(row.rows[0]!.n).toBe("1");
    expect(row.rows[0]!.created_by).toBe(USER);
  });
});


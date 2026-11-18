/**
 * Tok priloga na pravoj bazi uz S3 klijent kao testni duplikat (bez pravog MinIO-a):
 * presign → registracija (INSERT) → potvrda → lista → preuzimanje;
 * tuđa firma NOT_FOUND; uloga bez attachments.view → 403.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { companyId } from "@gradix/db";
import { can } from "./permissions";

type StoredObject = { sizeBytes: number; contentType: string };
const objectStore = new Map<string, StoredObject>();

vi.mock("./storage", async () => {
  const actual = (await vi.importActual("./storage")) as Record<string, unknown>;
  return {
    ...actual,
    storageConfig: () => ({
      configured: true,
      client: {
        send: async (command: { input?: { Key?: string; Bucket?: string } }) => {
          const key = command.input?.Key;
          if (!key) throw Object.assign(new Error("NoSuchKey"), { name: "NotFound" });
          const found = objectStore.get(key);
          if (!found) throw Object.assign(new Error("NoSuchKey"), { name: "NotFound" });
          return { ContentLength: found.sizeBytes, ContentType: found.contentType };
        },
      },
      presignClient: {},
      bucket: "gradix-test",
      publicEndpoint: "https://minio.test.example",
    }),
    presignUpload: async (input: { key: string; contentType: string }) => ({
      url: `https://minio.test.example/put/${encodeURIComponent(input.key)}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
    presignDownload: async (input: { key: string; fileName: string }) => ({
      url: `https://minio.test.example/get/${encodeURIComponent(input.key)}?name=${encodeURIComponent(input.fileName)}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    statObject: async (input: { key: string }) => {
      const found = objectStore.get(input.key);
      if (!found) return { exists: false };
      return { exists: true, sizeBytes: found.sizeBytes, contentType: found.contentType };
    },
  };
});

vi.mock("./guard", () => ({
  guard: async (_request: NextRequest, permission: string) => {
    const role = (globalThis as { __attTestRole?: string }).__attTestRole ?? "OWNER";
    const company = (globalThis as { __attTestCompany?: string }).__attTestCompany ?? "";
    const userId = (globalThis as { __attTestUser?: string }).__attTestUser ?? "";
    if (!can([role], permission as "obligations.attachments.view")) {
      return {
        ok: false as const,
        response: new Response(JSON.stringify({ success: false, error: { code: "FORBIDDEN" } }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      };
    }
    return {
      ok: true as const,
      ctx: { userId, companyId: company, roles: [role], email: "att@test.example" },
    };
  },
}));

const {
  registerAttachment,
  confirmAttachment,
  getObligation,
  attachmentDownloadUrl,
  isServiceError,
} = await import("./obligation-service");
const { GET: attachmentUrlRoute } = await import(
  "@/app/api/obligations/[id]/attachments/[attachmentId]/url/route"
);

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_att_${RUN}`;
const OTHER = `cmp_attx_${RUN}`;
const USER = `usr_att_${RUN}`;
const WRK = `wrk_att_${RUN}`;
const TYPE = `obt_att_${RUN}`;
const OBL = `obl_att_${RUN}`;

describeDb("obligation attachment flow (PostgreSQL + S3 double)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 2 });
  let attachmentId = "";
  let objectKey = "";

  beforeAll(async () => {
    objectStore.clear();
    for (const [id, slug] of [[CO, `att-${RUN}`], [OTHER, `attx-${RUN}`]] as const) {
      await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'Att', $2)", [id, slug]);
    }
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
    await admin.query("DELETE FROM public.companies WHERE id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.users WHERE id = $1", [USER]);
    await admin.end();
    await app.end();
  });

  it("presign → INSERT → confirm → lista → download; tuđa firma 404; WORKER 403", async () => {
    const head = new TextEncoder().encode("%PDF-1.7\nsinteticki\n");
    const actor = { userId: USER, roles: ["OWNER"] };
    const registered = await registerAttachment(app, companyId(CO), actor, OBL, {
      fileName: "sinteticki.pdf",
      sizeBytes: head.byteLength,
      sha256: "c".repeat(64),
      head,
    });
    expect(isServiceError(registered)).toBe(false);
    if (isServiceError(registered)) return;
    expect(registered.uploadUrl).toContain("https://minio.test.example/put/");
    expect(registered.attachment.status).toBe("pending");
    attachmentId = registered.attachment.id;
    const keyRow = await admin.query<{ object_key: string }>(
      "SELECT object_key FROM public.obligation_attachments WHERE id = $1 AND company_id = $2",
      [attachmentId, CO],
    );
    objectKey = keyRow.rows[0]!.object_key;
    expect(objectKey.length).toBeGreaterThan(8);
    const createdBy = await admin.query<{ created_by: string }>(
      "SELECT created_by FROM public.obligation_attachments WHERE id = $1 AND company_id = $2",
      [attachmentId, CO],
    );
    expect(createdBy.rows[0]?.created_by).toBe(USER);

    // Simulacija PUT na S3 duplikat (presign URL se ne zove mrežno).
    objectStore.set(objectKey, { sizeBytes: head.byteLength, contentType: "application/pdf" });

    const confirmed = await confirmAttachment(app, companyId(CO), actor, OBL, attachmentId);
    expect(isServiceError(confirmed)).toBe(false);
    if (isServiceError(confirmed)) return;
    expect(confirmed.attachment.status).toBe("ready");

    const listed = await getObligation(app, companyId(CO), OBL, { includeAttachments: true });
    expect(isServiceError(listed)).toBe(false);
    if (isServiceError(listed)) return;
    expect(listed.obligation.attachments.map((row) => row.id)).toContain(attachmentId);

    const download = await attachmentDownloadUrl(app, companyId(CO), OBL, attachmentId);
    expect(isServiceError(download)).toBe(false);
    if (isServiceError(download)) return;
    expect(download.url).toContain("https://minio.test.example/get/");

    const foreign = await attachmentDownloadUrl(app, companyId(OTHER), OBL, attachmentId);
    expect(isServiceError(foreign) && foreign.code).toBe("NOT_FOUND");

    (globalThis as { __attTestRole?: string }).__attTestRole = "WORKER";
    (globalThis as { __attTestCompany?: string }).__attTestCompany = CO;
    (globalThis as { __attTestUser?: string }).__attTestUser = USER;
    expect(can(["WORKER"], "obligations.attachments.view")).toBe(false);
    const forbidden = await attachmentUrlRoute(
      new NextRequest(`http://interni/api/obligations/${OBL}/attachments/${attachmentId}/url`),
      { params: Promise.resolve({ id: OBL, attachmentId }) },
    );
    expect(forbidden.status).toBe(403);

    (globalThis as { __attTestRole?: string }).__attTestRole = "OWNER";
    const allowed = await attachmentUrlRoute(
      new NextRequest(`http://interni/api/obligations/${OBL}/attachments/${attachmentId}/url`),
      { params: Promise.resolve({ id: OBL, attachmentId }) },
    );
    expect(allowed.status).toBe(200);
  });
});

/**
 * F0.2 — jedan obrazac priloga na pravoj bazi, uz S3 klijent kao testni duplikat.
 *
 * Provjerava ono što je ranije bilo tri puta copy-paste i zato tri puta moglo otići na svoje:
 *   1. `canUseEntity` nema veze s ovim — dozvola dolazi iz TIPA entiteta, ne iz URL-a rute;
 *   2. prilog tuđe firme je 404, ne 403 (ne odajemo da postoji);
 *   3. `DELETE` ruta samo MEKO briše — grant za `DELETE` na tabeli ne postoji;
 *   4. `url` ruta traži dozvolu MODULA: WORKER vidi obavezu, ali ne i njen nalaz.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
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
        send: async (command: { input?: { Key?: string } }) => {
          const key = command.input?.Key;
          const found = key ? objectStore.get(key) : undefined;
          if (!found) throw Object.assign(new Error("NoSuchKey"), { name: "NotFound" });
          return { ContentLength: found.sizeBytes, ContentType: found.contentType };
        },
      },
      presignClient: {},
      bucket: "gradix-test",
      publicEndpoint: "https://minio.test.example",
    }),
    presignUpload: async (input: { key: string }) => ({
      url: `https://minio.test.example/put/${encodeURIComponent(input.key)}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
    presignDownload: async (input: { key: string }) => ({
      url: `https://minio.test.example/get/${encodeURIComponent(input.key)}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    statObject: async (input: { key: string }) => {
      const found = objectStore.get(input.key);
      return found ? { exists: true, ...found } : { exists: false };
    },
  };
});

vi.mock("./guard", () => ({
  guard: async (request: NextRequest, permission?: string) => {
    const role = (globalThis as { __attTestRole?: string }).__attTestRole ?? "OWNER";
    const company = (globalThis as { __attTestCompany?: string }).__attTestCompany ?? "";
    const userId = (globalThis as { __attTestUser?: string }).__attTestUser ?? "";
    if (permission && !can([role], permission as Parameters<typeof can>[1])) {
      return {
        ok: false as const,
        response: new Response(JSON.stringify({ success: false, error: { code: "FORBIDDEN" } }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      };
    }
    void request;
    return { ok: true as const, ctx: { userId, companyId: company, roles: [role], email: "a@t.example" } };
  },
}));

const { GET: listRoute, POST: registerRoute } = await import("@/app/api/attachments/route");
const { POST: confirmRoute } = await import("@/app/api/attachments/[id]/confirm/route");
const { GET: urlRoute } = await import("@/app/api/attachments/[id]/url/route");
const { DELETE: deleteRoute } = await import("@/app/api/attachments/[id]/route");

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_ua_${RUN}`;
const OTHER = `cmp_uax_${RUN}`;
const USER = `usr_ua_${RUN}`;
const WRK = `wrk_ua_${RUN}`;
const TYPE = `obt_ua_${RUN}`;
const OBL = `obl_ua_${RUN}`;

const json = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const actAs = (role: string, company: string) => {
  (globalThis as { __attTestRole?: string }).__attTestRole = role;
  (globalThis as { __attTestCompany?: string }).__attTestCompany = company;
  (globalThis as { __attTestUser?: string }).__attTestUser = USER;
};

const envelope = <T>(value: unknown) => value as { success: boolean; data: T; error?: { code: string } };

describeDb("F0.2 jedinstveni /api/attachments", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 2 });
  let attachmentId = "";
  let objectKey = "";
  const head = new TextEncoder().encode("%PDF-1.7\nsinteticki\n");

  beforeAll(async () => {
    objectStore.clear();
    for (const [id, slug] of [[CO, `ua-${RUN}`], [OTHER, `uax-${RUN}`]] as const) {
      await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'UA', $2)", [id, slug]);
    }
    await admin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, 'ua-${RUN}@test.example', 'x', 'U', 'A', false)`,
      [USER],
    );
    await admin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, $2, 'Rad', 'UA', '2024-01-01')`,
      [WRK, CO],
    );
    await admin.query(
      `INSERT INTO public.obligation_types (id, company_id, code, label, entity_kind)
       VALUES ($1, $2, $3, 'UA tip', 'WORKER')`,
      [TYPE, CO, `UA${RUN}`.toUpperCase().slice(0, 40)],
    );
    await admin.query(
      `INSERT INTO public.obligations (id, company_id, type_id, worker_id, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [OBL, CO, TYPE, WRK, USER],
    );
  }, 60_000);

  afterAll(async () => {
    await admin.query("DELETE FROM public.attachments WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.obligations WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.obligation_types WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.workers WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.companies WHERE id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.users WHERE id = $1", [USER]);
    await admin.end();
    await app.end();
  });

  it("register → confirm → lista → url → meko brisanje", async () => {
    actAs("OWNER", CO);
    const registered = await registerRoute(
      json("http://interni/api/attachments", {
        entityType: "OBLIGATION",
        entityId: OBL,
        fileName: "sinteticki.pdf",
        sizeBytes: head.byteLength,
        sha256: "d".repeat(64),
        headBase64: Buffer.from(head).toString("base64"),
      }),
    );
    expect(registered.status).toBe(200);
    const created = envelope<{ attachment: { id: string; status: string }; uploadUrl: string }>(
      await registered.json(),
    ).data;
    expect(created.attachment.status).toBe("pending");
    expect(created.uploadUrl).toContain("https://minio.test.example/put/");
    attachmentId = created.attachment.id;

    const keyRow = await admin.query<{ object_key: string }>(
      "SELECT object_key FROM public.attachments WHERE id = $1",
      [attachmentId],
    );
    objectKey = keyRow.rows[0]!.object_key;
    // Firma je u putanji objekta: jedan bucket, ali tenant se vidi iz ključa.
    expect(objectKey.startsWith(`gx2/${CO}/obligation/${OBL}/`)).toBe(true);

    const tooEarly = await urlRoute(new NextRequest(`http://interni/api/attachments/${attachmentId}/url`), {
      params: Promise.resolve({ id: attachmentId }),
    });
    expect(tooEarly.status).toBe(404);

    objectStore.set(objectKey, { sizeBytes: head.byteLength, contentType: "application/pdf" });
    const confirmed = await confirmRoute(
      new NextRequest(`http://interni/api/attachments/${attachmentId}/confirm`, { method: "POST" }),
      { params: Promise.resolve({ id: attachmentId }) },
    );
    expect(confirmed.status).toBe(200);
    expect(envelope<{ attachment: { status: string } }>(await confirmed.json()).data.attachment.status).toBe("ready");

    const listed = await listRoute(
      new NextRequest(`http://interni/api/attachments?entityType=OBLIGATION&entityId=${OBL}`),
    );
    expect(listed.status).toBe(200);
    expect(envelope<{ attachments: { id: string }[] }>(await listed.json()).data.attachments.map((a) => a.id)).toContain(
      attachmentId,
    );

    const url = await urlRoute(new NextRequest(`http://interni/api/attachments/${attachmentId}/url`), {
      params: Promise.resolve({ id: attachmentId }),
    });
    expect(url.status).toBe(200);
    expect(envelope<{ url: string }>(await url.json()).data.url).toContain("https://minio.test.example/get/");

    const deleted = await deleteRoute(
      new NextRequest(`http://interni/api/attachments/${attachmentId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: attachmentId }) },
    );
    expect(deleted.status).toBe(200);
    const row = await admin.query<{ status: string; deleted_at: Date | null }>(
      "SELECT status, deleted_at FROM public.attachments WHERE id = $1",
      [attachmentId],
    );
    expect(row.rows[0]?.status).toBe("deleted");
    expect(row.rows[0]?.deleted_at).not.toBeNull();

    // Fizičkog brisanja nema: grant za DELETE ne postoji.
    await expect(
      app.query("DELETE FROM public.attachments WHERE id = $1", [attachmentId]),
    ).rejects.toThrow(/permission denied/);
  });

  it("tuđa firma dobija 404, ne 403", async () => {
    actAs("OWNER", OTHER);
    const listed = await listRoute(
      new NextRequest(`http://interni/api/attachments?entityType=OBLIGATION&entityId=${OBL}`),
    );
    expect(listed.status).toBe(404);
  });

  it("dozvola dolazi iz tipa entiteta: WORKER ne otvara nalaz, ali vidi listu obaveza kroz modul", async () => {
    actAs("WORKER", CO);
    expect(can(["WORKER"], "obligations.attachments.view")).toBe(false);
    const url = await urlRoute(new NextRequest(`http://interni/api/attachments/${attachmentId}/url`), {
      params: Promise.resolve({ id: attachmentId }),
    });
    expect(url.status).toBe(403);
    const listed = await listRoute(
      new NextRequest(`http://interni/api/attachments?entityType=OBLIGATION&entityId=${OBL}`),
    );
    expect(listed.status).toBe(403);
  });

  it("nepoznat tip entiteta ne prolazi validaciju prije baze", async () => {
    actAs("OWNER", CO);
    const response = await registerRoute(
      json("http://interni/api/attachments", {
        entityType: "PROJECT",
        entityId: OBL,
        fileName: "x.pdf",
        sizeBytes: 10,
        sha256: "e".repeat(64),
      }),
    );
    expect(response.status).toBe(400);
  });
});

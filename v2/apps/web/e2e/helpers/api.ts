/**
 * API setup (pravilo 3): stanje preko request + sesija; UI samo za tok/pregled.
 * Self-owned: jedinstveni kodovi po testu (pravilo 1).
 * Odgovori: `{ success: true, data: T }`.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export function uniqueCode(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${stamp}_${rand}`.slice(0, 40);
}

type Envelope = { success?: boolean; data?: Record<string, unknown>; error?: unknown };

async function readData(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  label: string,
): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Envelope;
  expect(response.ok(), `${label}: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.success, label).toBe(true);
  return (body.data ?? {}) as Record<string, unknown>;
}

export function apiFrom(page: Page): APIRequestContext {
  return page.request;
}

export async function createPartner(
  api: APIRequestContext,
  input?: { code?: string; name?: string; kind?: string },
): Promise<{ id: string; code: string }> {
  const code = input?.code ?? uniqueCode("ptr_e2e");
  const data = await readData(
    await api.post("/api/partners", {
      data: {
        code,
        name: input?.name ?? `E2E Partner ${code}`,
        kind: input?.kind ?? "CLIENT",
      },
    }),
    "partners.create",
  );
  const id = String(data.id ?? "");
  expect(id, "partner id").toBeTruthy();
  return { id, code };
}

export async function createTender(
  api: APIRequestContext,
  partnerId: string,
  input?: { title?: string },
): Promise<{ id: string; title: string }> {
  const title = input?.title ?? `tnd_e2e_${uniqueCode("t")}`;
  const data = await readData(
    await api.post("/api/tenders", {
      data: {
        title,
        partnerId,
        submittedValueAmount: "1000.00",
        currencyCode: "BAM",
        note: "e2e self-owned",
      },
    }),
    "tenders.create",
  );
  const id = String(data.id ?? "");
  expect(id, "tender id").toBeTruthy();
  return { id, title };
}

export async function patchTenderStatus(
  api: APIRequestContext,
  tenderId: string,
  status: "SUBMITTED" | "WON" | "LOST" | "WITHDRAWN",
): Promise<void> {
  await readData(
    await api.patch(`/api/tenders/${tenderId}`, { data: { status } }),
    `tenders.patch ${status}`,
  );
}

export async function convertTender(
  api: APIRequestContext,
  tenderId: string,
): Promise<{ projectId: string }> {
  const data = await readData(
    await api.post(`/api/tenders/${tenderId}/convert`, { data: {} }),
    "tenders.convert",
  );
  const projectId = String(data.projectId ?? "");
  expect(projectId, "converted projectId").toBeTruthy();
  return { projectId };
}

export async function createProject(
  api: APIRequestContext,
  input?: { code?: string; name?: string },
): Promise<{ id: string; code: string }> {
  const code = (input?.code ?? uniqueCode("prj_e2e")).slice(0, 40);
  const data = await readData(
    await api.post("/api/projects", {
      data: {
        code,
        name: input?.name ?? `E2E Projekat ${code}`,
        status: "ACTIVE",
      },
    }),
    "projects.create",
  );
  const project = data.project as { id?: string } | undefined;
  const id = String(project?.id ?? "");
  expect(id, "project id").toBeTruthy();
  return { id, code };
}

export async function createWorker(
  api: APIRequestContext,
  input?: { firstName?: string; lastName?: string },
): Promise<{ id: string }> {
  const stamp = uniqueCode("wrk");
  const data = await readData(
    await api.post("/api/workers", {
      data: {
        firstName: input?.firstName ?? "E2E",
        lastName: input?.lastName ?? stamp.slice(-12),
        hiredAt: new Date().toISOString().slice(0, 10),
        engagement: "PERMANENT",
      },
    }),
    "workers.create",
  );
  const worker = data.worker as { id?: string } | undefined;
  const id = String(worker?.id ?? "");
  expect(id, "worker id").toBeTruthy();
  return { id };
}

export async function listEquipmentCategories(
  api: APIRequestContext,
): Promise<{ id: string; code: string }[]> {
  const response = await api.get("/api/equipment-categories");
  const body = (await response.json()) as Envelope;
  expect(response.ok()).toBeTruthy();
  const categories = (body.data?.categories ?? []) as { id: string; code: string }[];
  return categories;
}

export async function createMachine(
  api: APIRequestContext,
  categoryId: string,
  input?: { code?: string; name?: string },
): Promise<{ id: string; code: string }> {
  const code = (input?.code ?? uniqueCode("mas")).slice(0, 20);
  const data = await readData(
    await api.post("/api/equipment", {
      data: {
        code,
        name: input?.name ?? `E2E Mašina ${code}`,
        categoryId,
        ownership: "OWN",
        meter: "HOURS",
        meterValue: 0,
      },
    }),
    "equipment.create",
  );
  const machine = data.machine as { id?: string } | undefined;
  const id = String(machine?.id ?? "");
  expect(id, "machine id").toBeTruthy();
  return { id, code };
}

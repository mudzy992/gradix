/**
 * API setup preko page.evaluate(fetch) — browser cookie jar (page.request u CI
 * ne šalje gx_at nakon next start + Secure cookies na 127.0.0.1).
 */
import { expect, type Page } from "@playwright/test";

export function uniqueCode(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${stamp}_${rand}`.slice(0, 40);
}

type FetchResult = { status: number; body: Record<string, unknown> };

async function apiFetch(
  page: Page,
  method: string,
  path: string,
  data?: Record<string, unknown>,
): Promise<FetchResult> {
  return page.evaluate(
    async ({ method: m, path: p, data: d }) => {
      const response = await fetch(p, {
        method: m,
        credentials: "include",
        headers: d ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
        body: d ? JSON.stringify(d) : undefined,
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: response.status, body };
    },
    { method, path, data },
  );
}

async function readData(page: Page, method: string, path: string, data: Record<string, unknown> | undefined, label: string): Promise<Record<string, unknown>> {
  const result = await apiFetch(page, method, path, data);
  const envelope = result.body as { success?: boolean; data?: Record<string, unknown> };
  expect(result.status < 400, `${label}: ${result.status} ${JSON.stringify(result.body)}`).toBeTruthy();
  expect(envelope.success, label).toBe(true);
  return (envelope.data ?? {}) as Record<string, unknown>;
}

/** @deprecated Prefer page-based helpers; kept for call-site type. */
export function apiFrom(page: Page): Page {
  return page;
}

export async function createPartner(
  page: Page,
  input?: { code?: string; name?: string; kind?: string },
): Promise<{ id: string; code: string }> {
  const code = input?.code ?? uniqueCode("ptr_e2e");
  const data = await readData(page, "POST", "/api/partners", {
    code,
    name: input?.name ?? `E2E Partner ${code}`,
    kind: input?.kind ?? "CLIENT",
  }, "partners.create");
  const id = String(data.id ?? "");
  expect(id, "partner id").toBeTruthy();
  return { id, code };
}

export async function createTender(
  page: Page,
  partnerId: string,
  input?: { title?: string },
): Promise<{ id: string; title: string }> {
  const title = input?.title ?? `tnd_e2e_${uniqueCode("t")}`;
  const data = await readData(page, "POST", "/api/tenders", {
    title,
    partnerId,
    submittedValueAmount: "1000.00",
    currencyCode: "BAM",
    note: "e2e self-owned",
  }, "tenders.create");
  const id = String(data.id ?? "");
  expect(id, "tender id").toBeTruthy();
  return { id, title };
}

export async function patchTenderStatus(
  page: Page,
  tenderId: string,
  status: "SUBMITTED" | "WON" | "LOST" | "WITHDRAWN",
): Promise<void> {
  await readData(page, "PATCH", `/api/tenders/${tenderId}`, { status }, `tenders.patch ${status}`);
}

export async function convertTender(
  page: Page,
  tenderId: string,
): Promise<{ projectId: string }> {
  const data = await readData(page, "POST", `/api/tenders/${tenderId}/convert`, {}, "tenders.convert");
  const projectId = String(data.projectId ?? "");
  expect(projectId, "converted projectId").toBeTruthy();
  return { projectId };
}

export async function createProject(
  page: Page,
  input?: { code?: string; name?: string },
): Promise<{ id: string; code: string }> {
  const code = (input?.code ?? uniqueCode("prj_e2e")).slice(0, 40);
  const data = await readData(page, "POST", "/api/projects", {
    code,
    name: input?.name ?? `E2E Projekat ${code}`,
    status: "ACTIVE",
  }, "projects.create");
  const project = data.project as { id?: string } | undefined;
  const id = String(project?.id ?? "");
  expect(id, "project id").toBeTruthy();
  return { id, code };
}

export async function createWorker(
  page: Page,
  input?: { firstName?: string; lastName?: string },
): Promise<{ id: string }> {
  const stamp = uniqueCode("wrk");
  const data = await readData(page, "POST", "/api/workers", {
    firstName: input?.firstName ?? "E2E",
    lastName: input?.lastName ?? stamp.slice(-12),
    hiredAt: new Date().toISOString().slice(0, 10),
    engagement: "PERMANENT",
  }, "workers.create");
  const worker = data.worker as { id?: string } | undefined;
  const id = String(worker?.id ?? "");
  expect(id, "worker id").toBeTruthy();
  return { id };
}

export async function listEquipmentCategories(
  page: Page,
): Promise<{ id: string; code: string }[]> {
  const result = await apiFetch(page, "GET", "/api/equipment-categories");
  expect(result.status < 400).toBeTruthy();
  const envelope = result.body as { data?: { categories?: { id: string; code: string }[] } };
  return envelope.data?.categories ?? [];
}

export async function createMachine(
  page: Page,
  categoryId: string,
  input?: { code?: string; name?: string },
): Promise<{ id: string; code: string }> {
  const code = (input?.code ?? uniqueCode("mas")).slice(0, 20);
  const data = await readData(page, "POST", "/api/equipment", {
    code,
    name: input?.name ?? `E2E Mašina ${code}`,
    categoryId,
    ownership: "OWN",
    meter: "HOURS",
    meterValue: 0,
  }, "equipment.create");
  const machine = data.machine as { id?: string } | undefined;
  const id = String(machine?.id ?? "");
  expect(id, "machine id").toBeTruthy();
  return { id, code };
}

export async function apiPost(
  page: Page,
  path: string,
  data: Record<string, unknown>,
): Promise<FetchResult> {
  return apiFetch(page, "POST", path, data);
}

export async function apiPatch(
  page: Page,
  path: string,
  data: Record<string, unknown>,
): Promise<FetchResult> {
  return apiFetch(page, "PATCH", path, data);
}

/**
 * API setup preko page.evaluate(fetch) — browser cookie jar (page.request u CI
 * ne šalje gx_at nakon next start + Secure cookies na 127.0.0.1).
 */
import { expect, type Page } from "@playwright/test";
import { calendarDateFromLocalDate } from "@gradix/domain";

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
  status: "GO_NO_GO" | "PREPARATION" | "SUBMITTED" | "EVALUATION" | "WON" | "LOST" | "WITHDRAWN" | "CANCELLED",
  body: Record<string, unknown> = {},
): Promise<void> {
  await readData(page, "PATCH", `/api/tenders/${tenderId}`, { status, ...body }, `tenders.patch ${status}`);
}

export async function decideTender(
  page: Page,
  tenderId: string,
  participate = true,
): Promise<void> {
  await readData(
    page,
    "POST",
    `/api/tenders/${tenderId}/decision`,
    { participate, reason: "E2E odluka o učešću" },
    "tenders.decision",
  );
}

/**
 * Rješava kontrolnu listu: sve stavke koje nijesu garancije idu u „nije primjenjivo“ sa
 * razlogom. Bez toga predaja pada na `TENDER_CHECKLIST_INCOMPLETE` — i to je namjerno.
 */
export async function completeTenderChecklist(page: Page, tenderId: string): Promise<void> {
  const data = await readData(page, "GET", `/api/tenders/${tenderId}/checklist`, undefined, "tenders.checklist");
  const items = (data.items ?? []) as Array<{ id: string; guaranteeType: string | null }>;
  for (const item of items) {
    if (item.guaranteeType) continue;
    await readData(
      page,
      "PATCH",
      `/api/tenders/${tenderId}/checklist/${item.id}`,
      { status: "NOT_APPLICABLE", note: "E2E: nije primjenjivo" },
      `tenders.checklist ${item.id}`,
    );
  }
}

export async function putTenderOutcome(
  page: Page,
  tenderId: string,
  result: "WON" | "LOST" | "WITHDRAWN" | "CANCELLED",
): Promise<void> {
  await readData(
    page,
    "PUT",
    `/api/tenders/${tenderId}/outcome`,
    { result, lostReason: result === "WON" ? null : "PRICE" },
    "tenders.outcome",
  );
}

/**
 * Prolazak kroz sve kapije do `WON`: odluka → priprema → kontrolna lista → predaja →
 * evaluacija → ishod → dobijeno. Jedan pomoćnik, jer bi pet testova ponavljalo isti niz.
 */
export async function walkTenderToWon(page: Page, tenderId: string): Promise<void> {
  await patchTenderStatus(page, tenderId, "GO_NO_GO");
  await decideTender(page, tenderId, true);
  await patchTenderStatus(page, tenderId, "PREPARATION", {
    deadlineAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    questionsDeadlineAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  });
  await completeTenderChecklist(page, tenderId);
  await patchTenderStatus(page, tenderId, "SUBMITTED");
  await patchTenderStatus(page, tenderId, "EVALUATION");
  await putTenderOutcome(page, tenderId, "WON");
  await patchTenderStatus(page, tenderId, "WON");
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
    hiredAt: calendarDateFromLocalDate(new Date()),
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
  // Inventarska oznaka: A–Z, 0–9, crtica (bez underscore).
  const code = (input?.code ?? `MAS-${Date.now().toString(36).toUpperCase()}`.slice(0, 20));
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

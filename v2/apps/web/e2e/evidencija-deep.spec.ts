/**
 * Deep Evidencija — self-owned partner/tender/project/worker/machine + UI assert.
 * Prilozi MinIO: CI-SKIP (vidi e2e-coverage MATRIX).
 */
import { expect, test } from "@playwright/test";
import {
  apiFrom,
  convertTender,
  createMachine,
  createPartner,
  createProject,
  createTender,
  createWorker,
  listEquipmentCategories,
  patchTenderStatus,
} from "./helpers/api";
import { E2E_USERS, loginApi, loginUi, requireE2ePassword } from "./helpers/auth";
import { expectHeading } from "./helpers/assert";

test.beforeAll(() => {
  requireE2ePassword();
});

test.describe("evidencija deep", { tag: ["@deep", "@deep-evidencija"] }, () => {
  test("partner + tender DRAFT→SUBMITTED→WON→convert; UI vidi tender", async ({ page }) => {
    await loginApi(page, E2E_USERS.admin);
    const api = apiFrom(page);
    const partner = await createPartner(api);
    const tender = await createTender(api, partner.id);
    await patchTenderStatus(api, tender.id, "SUBMITTED");
    await patchTenderStatus(api, tender.id, "WON");
    const { projectId } = await convertTender(api, tender.id);
    expect(projectId).toBeTruthy();

    await page.goto("/ured/tenderi");
    await expectHeading(page, "Tenderi");
    await expect(page.getByText(tender.title, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("projekat, radnik, mašina self-owned vidljivi u listama", async ({ page }) => {
    await loginApi(page, E2E_USERS.admin);
    const api = apiFrom(page);
    const project = await createProject(api);
    const worker = await createWorker(api);
    const categories = await listEquipmentCategories(api);
    expect(categories.length, "seed kategorije").toBeGreaterThan(0);
    const machine = await createMachine(api, categories[0]!.id);

    await page.goto("/ured/projekti");
    await expectHeading(page, "Projekti");
    await expect(page.getByText(project.code, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    await page.goto("/ured/radnici");
    await expectHeading(page, "Radnici");
    expect(worker.id).toBeTruthy();
    await expect(page.getByText("E2E", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    await page.goto("/ured/masine");
    await expectHeading(page, "Mašine i vozila");
    await expect(page.getByText(machine.code, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("partneri UI: self-owned CLIENT u listi", async ({ page }) => {
    await loginApi(page, E2E_USERS.admin);
    const partner = await createPartner(apiFrom(page), { kind: "CLIENT" });
    await page.goto("/ured/partneri");
    await expectHeading(page, "Partneri");
    await expect(page.getByText(partner.code, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("rokovi render za admin; radnik vidi rokovi, ne uvoz", async ({ page }) => {
    await loginUi(page, E2E_USERS.admin);
    await page.goto("/ured/rokovi");
    await expectHeading(page, "Rokovi");
    await loginUi(page, E2E_USERS.worker);
    await page.goto("/ured/rokovi");
    await expectHeading(page, "Rokovi");
    await page.goto("/ured/uvoz");
    await expect(page.getByRole("heading", { name: "Nemate pristup ovoj stranici" })).toBeVisible();
  });

  test("tender LOST terminal; invalid skip DRAFT→WON odbijen", async ({ page }) => {
    await loginApi(page, E2E_USERS.admin);
    const api = apiFrom(page);
    const partner = await createPartner(api);
    const tender = await createTender(api, partner.id);
    const bad = await api.patch(`/api/tenders/${tender.id}`, { data: { status: "WON" } });
    expect(bad.ok()).toBeFalsy();
    await patchTenderStatus(api, tender.id, "SUBMITTED");
    await patchTenderStatus(api, tender.id, "LOST");
    await page.goto(`/ured/tenderi`);
    await expect(page.getByText(tender.title, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });
});

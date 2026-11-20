/**
 * Deep Mehanizacija — API create sati/gorivo/ture + UI lista.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  apiPost,
  createMachine,
  createProject,
  listEquipmentCategories,
  uniqueCode,
} from "./helpers/api";
import { E2E_USERS, loginApi, requireE2ePassword } from "./helpers/auth";
import { expectHeading } from "./helpers/assert";

test.beforeAll(() => {
  requireE2ePassword();
});

async function setupMachine(page: Page) {
  await loginApi(page, E2E_USERS.admin);
  const categories = await listEquipmentCategories(page);
  const machine = await createMachine(page, categories[0]!.id);
  const project = await createProject(page);
  return { machine, project };
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

test.describe("mehanizacija deep", { tag: ["@deep", "@deep-mehanizacija"] }, () => {
  test("sati mašine: API unos + UI lista", async ({ page }) => {
    const { machine, project } = await setupMachine(page);
    const res = await apiPost(page, "/api/machine-work-logs", {
      machineId: machine.id,
      projectId: project.id,
      startedAt: isoHoursAgo(3),
      endedAt: isoHoursAgo(1),
      mode: "WORK",
      note: uniqueCode("sat"),
    });
    expect(res.status < 400, JSON.stringify(res.body)).toBeTruthy();
    await page.goto("/ured/sati-masine");
    await expectHeading(page, "Sati mašina");
    await expect(page.getByText(machine.code, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("gorivo: API unos + UI", async ({ page }) => {
    const { machine, project } = await setupMachine(page);
    const res = await apiPost(page, "/api/fuel-entries", {
      machineId: machine.id,
      projectId: project.id,
      filledAt: new Date().toISOString(),
      liters: 12.5,
      totalAmount: "50.00",
      currencyCode: "BAM",
      note: uniqueCode("fuel"),
    });
    expect(res.status < 400, JSON.stringify(res.body)).toBeTruthy();
    await page.goto("/ured/gorivo");
    await expectHeading(page, "Gorivo");
    await expect(page.getByText(machine.code, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("ture: API unos + UI", async ({ page }) => {
    const { machine, project } = await setupMachine(page);
    const res = await apiPost(page, "/api/hauls", {
      machineId: machine.id,
      projectId: project.id,
      hauledAt: new Date().toISOString(),
      originText: "E2E origin",
      destinationText: "E2E dest",
      materialText: "šljunak",
      quantity: 10,
      quantityUnit: "M3",
      tripCount: 2,
      note: uniqueCode("haul"),
    });
    expect(res.status < 400, JSON.stringify(res.body)).toBeTruthy();
    await page.goto("/ured/ture");
    await expectHeading(page, "Ture");
    await expect(page.getByText(machine.code, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("stranice dnevni pregled i kvarovi renderuju se za admina", async ({ page }) => {
    await loginApi(page, E2E_USERS.admin);
    await page.goto("/ured/dnevni-pregled");
    await expectHeading(page, "Dnevni pregled");
    await page.goto("/ured/kvarovi");
    await expectHeading(page, "Kvarovi");
  });
});

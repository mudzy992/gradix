import { describe, expect, it } from "vitest";
import { validSiteDiaryItemPushItem, type R4SiteDiaryItemPushItem } from "./r6-diary-hse-sync";

const base: R4SiteDiaryItemPushItem = {
  localId: "00000000-0000-4000-8000-000000000001",
  entityType: "site_diary_item",
  diaryItemId: "item-1",
  diaryProjectId: "project-1",
  diaryDate: "2026-10-05",
  deviceSentAt: "2026-10-08T08:00:00Z",
  item: { boqItemId: null, description: "Radovi", unit: "m", quantity: "2.5", source: "MANUAL" },
};

describe("datum dnevnika u offline količini", () => {
  it("ne zavisi od dana slanja i traži potpun poslovni ključ", () => {
    expect(validSiteDiaryItemPushItem(base)).toBe(true);
    expect(validSiteDiaryItemPushItem({ ...base, diaryDate: undefined })).toBe(false);
    expect(validSiteDiaryItemPushItem({ ...base, diaryProjectId: undefined })).toBe(false);
    // Stari red se može parsirati, ali ga server izričito odbija, bez pogađanja dana.
    expect(validSiteDiaryItemPushItem({ ...base, diaryProjectId: undefined, diaryDate: undefined })).toBe(true);
  });

  it.each(["2026-02-29", "2026-13-01", "0000-01-01", "2026-04-31"])("odbija nepostojeći datum %s", (diaryDate) => {
    expect(validSiteDiaryItemPushItem({ ...base, diaryDate })).toBe(false);
  });
});

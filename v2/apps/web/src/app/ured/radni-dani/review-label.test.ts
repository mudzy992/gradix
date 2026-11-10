import { describe, expect, it } from "vitest";
import { reviewLabel } from "./review-label";

describe("uredski pregled — oznake za provjeru", () => {
  it("otvoren segment i nepoznat kraj traže provjeru; uredan dan nema oznaku", () => {
    expect(reviewLabel({ unknown_end: 0, open_entries: 1 })).toContain("otvoren segment");
    expect(reviewLabel({ unknown_end: 2, open_entries: 0 })).toContain("kraj nepoznat");
    expect(reviewLabel({ unknown_end: 0, open_entries: 0 })).toBeNull();
  });
});

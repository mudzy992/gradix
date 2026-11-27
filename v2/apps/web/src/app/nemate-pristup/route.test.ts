import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("403 stranica (A2.3)", () => {
  it("vraća HTTP 403, poruku i link na pregled", async () => {
    const response = await GET();
    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).toContain("Nemate pristup ovoj stranici");
    expect(html).toContain('href="/pregled"');
  });
});

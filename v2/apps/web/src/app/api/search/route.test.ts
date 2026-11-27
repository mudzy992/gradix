import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), pool: vi.fn(), search: vi.fn() }));
vi.mock("@/server/guard", () => ({ guard: mocks.guard }));
vi.mock("@/server/db", () => ({ getVerifiedPool: mocks.pool }));
vi.mock("@/server/global-search", () => ({ globalSearch: mocks.search }));
import { GET } from "./route";

const actor = { userId: "user", companyId: "company", roles: ["OWNER"], scope: "COMPANY", projectIds: null };
const request = (query: string) => new NextRequest(`http://localhost/api/search${query}`);

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ ok: true, ctx: actor });
    mocks.pool.mockResolvedValue("pool");
    mocks.search.mockResolvedValue([{ type: "PROJECT", title: "Most", href: "/ured/projekti/p" }]);
  });

  it("poštuje odbijanje guarda bez pristupa bazi", async () => {
    mocks.guard.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await GET(request("?q=most"))).status).toBe(401);
    expect(mocks.pool).not.toHaveBeenCalled();
  });

  it.each(["", "?q=x", "?q=%20%20", `?q=${"a".repeat(101)}`, "?q=foo%00bar"])(
    "odbija neispravan upit %s prije baze", async query => {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(mocks.pool).not.toHaveBeenCalled();
    },
  );

  it("vraća rezultat i trimovan upit prosljeđuje samo sa kontekstom iz sesije", async () => {
    const response = await GET(request("?q=%20Most%20&companyId=other"));
    expect(response.status).toBe(200);
    expect(mocks.search).toHaveBeenCalledWith("pool", actor, "Most");
    expect(await response.json()).toEqual({ success: true, data: { results: [{ type: "PROJECT", title: "Most", href: "/ured/projekti/p" }] } });
  });
});

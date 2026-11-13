/**
 * A1 (mobilni): email se čisti od kontrolnih znakova PRIJE slanja na server.
 *
 * NALAZ iz buga: `trim()` NE skida NUL (\u0000), a Postgres odbija 0x00 u stringu
 * (22P05) — prijava nakon odjave padala je s „Došlo je do greške.“ (500). Server sada
 * takav unos odbija s 400 (SafeText), a mobilni ga uklanja prije slanja, da prijava
 * radi čak i kad tipkovnica/autofill ubaci kontrolni znak. Test hvata TAČNO to:
 * šta je otišlo na žicu, a ne šta je korisnik ukucao.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const secure = vi.hoisted(() => ({
  getItemAsync: vi.fn(async (_key: string) => null as string | null),
  setItemAsync: vi.fn(async (_key: string, _value: string) => {}),
  deleteItemAsync: vi.fn(async (_key: string) => {}),
}));

vi.mock("expo-secure-store", () => secure);
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

const { login } = await import("./client");

/** Zapisano tijelo zadnjeg POST /api/auth/login. */
let sentBodies: { email: string; password: string }[] = [];

beforeEach(() => {
  sentBodies = [];
});

describe("login (A1): kontrolni znakovi ne idu na server", () => {
  it("NUL u emailu se skida prije slanja, ostatak teksta ostaje", async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.body) sentBodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            user: { id: "u1", displayName: "Test", roles: ["WORKER"] },
            companyId: "c1",
            mustChangePassword: false,
            accessToken: "at",
            refreshToken: "rt",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await login("ko\u0000ris@demo.ba", "lozinka");
      expect(sentBodies.length).toBe(1);
      expect(sentBodies[0]!.email).toBe("koris@demo.ba");
      // lozinka se NE dira: kontrolni znak u njoj znači pogrešan unos
      expect(sentBodies[0]!.password).toBe("lozinka");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("čist email prolazi nepromijenjen (bez dvostruke obrade)", async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.body) sentBodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            user: { id: "u1", displayName: "Test", roles: ["WORKER"] },
            companyId: "c1",
            mustChangePassword: false,
            accessToken: "at",
            refreshToken: "rt",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await login("  koris@demo.ba  ", "lozinka");
      expect(sentBodies[0]!.email).toBe("koris@demo.ba");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

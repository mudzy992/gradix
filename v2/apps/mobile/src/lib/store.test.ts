// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `lib/store` mora raditi na oba mjesta: na webu preko `localStorage`, na uređaju preko
 * `expo-secure-store`. Test pokriva web granu (jedina koju sandbox može izvršiti) i ključni
 * detalj: crtica u ključu se zamjenjuje prije nego ode u `SecureStore`.
 */
const secure = vi.hoisted(() => ({
  getItemAsync: vi.fn(async (_key: string) => null as string | null),
  setItemAsync: vi.fn(async (_key: string, _value: string) => {}),
  deleteItemAsync: vi.fn(async (_key: string) => {}),
}));

vi.mock("expo-secure-store", () => secure);
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

const store = await import("./store");

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("store (web)", () => {
  it("piše i čita isti ključ i vrijednost", async () => {
    await store.writeStore("gx-theme", "dark");
    expect(localStorage.getItem("gx-theme")).toBe("dark");
    expect(await store.readStore("gx-theme")).toBe("dark");
  });

  it("briše vrijednost", async () => {
    await store.writeStore("gx-theme", "light");
    await store.deleteStore("gx-theme");
    expect(await store.readStore("gx-theme")).toBeNull();
  });

  it("nedostajući ključ vraća null, ne grešku", async () => {
    expect(await store.readStore("nema-me")).toBeNull();
  });

  it("ne dira SecureStore dok je platforma web", async () => {
    await store.writeStore("gx_access", "token");
    expect(secure.setItemAsync).not.toHaveBeenCalled();
  });
});

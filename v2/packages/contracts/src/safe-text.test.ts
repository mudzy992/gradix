/**
 * A1 — SafeText: granica API-ja odbija kontrolne znakove (npr. NUL) u tekstualnim
 * poljima SVIH šema zahtjeva. Bez ove provjere takav unos stiže do Postgresa, koji ga
 * odbija (22P05, „invalid byte sequence for encoding "UTF8": 0x00“) i klijent vidi 500.
 *
 * Test radi na registru ruta (`ROUTES`), ne na ručnom spisku: nova ruta sa šemom koja
 * koristi goli `z.string()` za tekst pada ovdje dok ne pređe na `SafeText`.
 *
 * Jedini izuzetak je `SyncPushRequest` — tamo se kontrolni znak odbija PO STAVCI u
 * servisu (r4-sync-service), da jedna loša stavka ne ruši cijeli batch.
 */
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./routes";
import { hasControlChars, stripControlChars } from "./schemas";

const NUL = "a\u0000b";

/** Svako tekstualno polje u šemi (rekurzivno kroz objekte, nizove, unije). */
function stringPaths(schema: z.core.$ZodType, base: string[]): string[] {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return stringPaths(schema.unwrap(), base);
  }
  if (schema instanceof z.ZodDefault) return stringPaths(schema.removeDefault(), base);
  if (schema instanceof z.ZodCatch) return stringPaths(schema._def.innerType, base);
  if (schema instanceof z.ZodString) return [base.join(".")];
  if (schema instanceof z.ZodArray) return stringPaths(schema.element, base);
  if (schema instanceof z.ZodRecord) {
    // zod 4.6: vrijednost zapisa je u `def.valueType` (nema `valueSchema` getera)
    const value = (schema as unknown as { def: { valueType: z.core.$ZodType } }).def.valueType;
    return stringPaths(value, base);
  }
  if (schema instanceof z.ZodUnion) {
    return schema.options.flatMap((option) => stringPaths(option, base));
  }
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape).flatMap(([key, value]) => stringPaths(value, [...base, key]));
  }
  return [];
}

/** Vrijednost s NUL-om baš na zadatoj putanji polja; sve ostalo ostaje "čisto". */
function withNulAt(
  schema: z.core.$ZodType,
  target: string[],
  base: string[] = [],
): unknown {
  const path = base.join(".");
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return withNulAt(schema.unwrap(), target, base);
  }
  if (schema instanceof z.ZodDefault) return withNulAt(schema.removeDefault(), target, base);
  if (schema instanceof z.ZodCatch) return withNulAt(schema._def.innerType, target, base);
  if (schema instanceof z.ZodString) return path === target.join(".") ? NUL : "abc123";
  if (schema instanceof z.ZodNumber) return 1;
  if (schema instanceof z.ZodBoolean) return false;
  if (schema instanceof z.ZodLiteral) return schema.value;
  if (schema instanceof z.ZodEnum) return schema.options[0];
  if (schema instanceof z.ZodArray) return [withNulAt(schema.element, target, base)];
  if (schema instanceof z.ZodRecord) {
    const value = (schema as unknown as { def: { valueType: z.core.$ZodType } }).def.valueType;
    return { kljuc: withNulAt(value, target, [...base, "kljuc"]) };
  }
  if (schema instanceof z.ZodUnion) {
    // prva opcija koja sadrži ciljano polje
    for (const option of schema.options) {
      if (stringPaths(option, base).includes(target.join("."))) {
        return withNulAt(option, target, base);
      }
    }
    return withNulAt(schema.options[0]!, target, base);
  }
  if (schema instanceof z.ZodObject) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema.shape)) {
      out[key] = withNulAt(value, target, [...base, key]);
    }
    return out;
  }
  return NUL;
}

describe("SafeText (A1)", () => {
  it("prepoznaje kontrolne znakove, a dozvoljava tab, novi red i povratnik", () => {
    expect(hasControlChars("a\u0000b")).toBe(true);
    expect(hasControlChars("a\u0001b")).toBe(true);
    expect(hasControlChars("a\u007Fb")).toBe(true);
    expect(hasControlChars("redak\u000Bdrugi")).toBe(true); // vertikalni tab nije dozvoljen
    expect(hasControlChars("tab\tred\nnovi\rpovratnik")).toBe(false);
    expect(hasControlChars("običan tekst čžćšđ")).toBe(false);
  });

  it("stripControlChars skida NUL, a ne dira ostatak teksta", () => {
    expect(stripControlChars("ko\u0000ris@demo.ba")).toBe("koris@demo.ba");
    expect(stripControlChars("  koris@demo.ba  ")).toBe("  koris@demo.ba  "); // trim je posao pozivaoca
    expect(stripControlChars("čist tekst")).toBe("čist tekst");
  });

  it("svaka šema zahtjeva iz ROUTES odbija NUL u svakom tekstualnom polju", () => {
    const checked: string[] = [];
    for (const route of ROUTES) {
      if (route.method !== "POST" && route.method !== "PATCH") continue;
      if (!route.request) continue;
      // SyncPushRequest namjerno NEMA SafeText: odbijanje ide po stavci u servisu.
      if (route.path === "/api/sync/push") continue;
      const schema = route.request;
      const paths = stringPaths(schema, []);
      // Šeme bez ijednog tekstualnog polja (npr. MembershipPatch: samo enumi) nemaju
      // gdje da prime NUL — ništa se ne provjerava, ali ni ne preskače tiho: takva ruta
      // se pojavi u `checked` spisku samo ako ima bar jedno tekstualno polje.
      for (const path of paths) {
        const body = withNulAt(schema, path.split("."));
        const parsed = schema.safeParse(body);
        expect(
          parsed.success,
          `${route.method} ${route.path}: polje „${path}“ prihvata NUL — koristi SafeText`,
        ).toBe(false);
        checked.push(`${route.path}#${path}`);
      }
    }
    // Senka da test stvarno nešto provjerava (npr. prijelomom u registar ruta).
    expect(checked.length).toBeGreaterThan(100);
  });
});

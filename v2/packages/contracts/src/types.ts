/**
 * Tipovi izvedeni iz registra ruta — bez ručnog prepisivanja.
 *
 * `RouteResponse<"GET", "/api/me">` je ono što ruta vraća; `RouteRequest` je tijelo koje prima
 * (ili `undefined` kad ruta nema tijelo). Kad se ugovor promijeni, mijenja se i tip koji
 * klijent vidi, u istom trenutku — ne postoji mjesto gdje se to dvoje raziđe.
 *
 * Indeksiranje ide preko mapе ključevane sa `"METOD putanja"` jer `Extract` sa generičkim
 * parametrima ne sužava uniju (probano, tipovi ispadnu `never`).
 */
import type { z } from "zod";
import type { ROUTES } from "./routes";

import type { RouteSpec } from "./routes";

/** Ulaz u registru, normalizovan na `RouteSpec` (opciona polja tada postoje kao `T | undefined`). */
export type Route = (typeof ROUTES)[number] & RouteSpec;

export type RouteMap = { [R in Route as `${R["method"]} ${R["path"]}`]: R };

type Lookup<
  M extends string,
  P extends string,
> = `${M} ${P}` extends keyof RouteMap ? RouteMap[`${M} ${P}`] : never;

export type RouteResponse<M extends string, P extends string> =
  Lookup<M, P> extends { response: infer R }
    ? R extends z.ZodType
      ? z.output<R>
      : never
    : never;

export type RouteRequest<M extends string, P extends string> =
  Lookup<M, P> extends { request: infer R }
    ? R extends z.ZodType
      ? z.input<R>
      : undefined
    : undefined;

/** Parametri putanje za datu rutu, npr. `{ id: string }` za `/api/users/{id}/active`. */
export type RouteParams<P extends string> =
  P extends `${string}{${infer Param}}${infer Rest}`
    ? { [K in Param]: string } & RouteParams<Rest>
    : Record<string, never>;

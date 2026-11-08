/**
 * Tipiziran klijent — jedan način da aplikacija pozove API.
 *
 * Namjerno mali: `fetch`, envelope, kod greške kao `ApiError`, i to je sve. Nema keširanja,
 * nema retry logike, nema globalnog stanja — to je posao pozivaoca. Ono što klijent JESTE
 * garantuje: (1) putanja i metoda postoje u `ROUTES`, (2) tijelo zahtjeva i odgovora se
 * provjeravaju šemom, pa se razilaženje vidi u razvoju, ne na terenu.
 *
 * Radi u webu (cookie) i u mobilnom (Authorization: Bearer). Cookie se šalje samo ako je
 * pozivalac ne postavi — `fetch` u browseru to radi sam (`credentials: "same-origin"`).
 */
import type { z } from "zod";
import { ERROR_STATUS, type ErrorCode } from "./envelope";
import { buildPath, ROUTES, type RouteSpec } from "./routes";
import type { RouteResponse, RouteRequest } from "./types";

export type ApiErrorInit = {
  code: ErrorCode;
  message: string;
  status: number;
  /** Popunjeno kad tijelo nije bio očekivani envelope (proxy, 502, HTML). */
  raw?: unknown;
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly raw?: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.raw = init.raw;
  }

  /** Poruka za korisnika je uvijek naša; `code` nosi značenje. */
  get isAuth(): boolean {
    return this.status === 401;
  }
}

export type ClientOptions = {
  baseUrl?: string;
  /** Mobilni: `Authorization: Bearer …`. Web: ne postavlja se, ide cookie. */
  accessToken?: string | null;
  /** Test/SSR: injektira se `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Dodatni headeri (npr. `x-request-id`). */
  headers?: Record<string, string>;
};

export type RequestOptions = {
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  accessToken?: string | null;
};

type Method = RouteSpec["method"];

function findRoute(method: Method, path: string): RouteSpec {
  const route = ROUTES.find((entry) => entry.method === method && entry.path === path);
  if (!route) throw new Error(`Ruta ${method} ${path} nije u ugovoru.`);
  return route;
}

function buildUrl(baseUrl: string, path: string, params?: Record<string, string>, query?: RequestOptions["query"]): string {
  const url = new URL(buildPath(path, params), baseUrl || "http://localhost");
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return baseUrl ? url.toString() : `${url.pathname}${url.search}`;
}

/** Zaglavlja odgovora koja klijent mora da vidi (npr. `Retry-After` na 429). */
export type ClientResult<T> = { data: T; meta?: Record<string, unknown>; headers: Headers };

export function createClient(options: ClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const doFetch = options.fetch ?? globalThis.fetch;

  async function call<M extends Method, P extends string>(
    method: M,
    path: P,
    body?: unknown,
    params?: Record<string, string>,
    requestOptions: RequestOptions = {},
  ): Promise<ClientResult<RouteResponse<M, P>>> {
    const route = findRoute(method, path);
    const token = requestOptions.accessToken !== undefined ? requestOptions.accessToken : options.accessToken;

    const headers: Record<string, string> = { accept: "application/json", ...options.headers };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await doFetch(buildUrl(baseUrl, path, params, requestOptions.query), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
    });

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (route.raw) {
      if (!response.ok) {
        throw new ApiError({
          code: "INTERNAL",
          message: `Server je odgovorio ${response.status}.`,
          status: response.status,
          raw: parsed ?? text,
        });
      }
      return { data: parsed as RouteResponse<M, P>, headers: response.headers };
    }

    const envelope = parsed as
      | { success: true; data: unknown; meta?: Record<string, unknown> }
      | { success: false; error: { code: ErrorCode; message: string } }
      | null;

    if (!envelope || typeof envelope !== "object" || !("success" in envelope)) {
      throw new ApiError({
        code: response.ok ? "INTERNAL" : "INTERNAL",
        message: "Odgovor servera nije razumljiv. Pokušajte ponovo.",
        status: response.status,
        raw: parsed ?? text,
      });
    }

    if (!envelope.success) {
      throw new ApiError({
        code: envelope.error.code,
        message: envelope.error.message,
        status: response.status || ERROR_STATUS[envelope.error.code] || 500,
      });
    }

    // Provjera u razvoju: oblik se provjerava UVIJEK (jeftino), pa se greška u ugovoru
    // vidi kao `ApiError` sa jasnom porukom, umjesto `undefined` na ekranu.
    const check = route.response.safeParse(envelope.data);
    if (!check.success) {
      throw new ApiError({
        code: "INTERNAL",
        message: `Odgovor ne odgovara ugovoru (${method} ${path}).`,
        status: response.status,
        raw: check.error.issues,
      });
    }

    return {
      data: check.data as RouteResponse<M, P>,
      ...(envelope.meta ? { meta: envelope.meta } : {}),
      headers: response.headers,
    };
  }

  /** Tijelo se tipizira po ruti; u razvoju se i validira prije slanja. */
  async function send<M extends Method, P extends string>(
    method: M,
    path: P,
    body: RouteRequest<M, P>,
    params?: Record<string, string>,
    requestOptions?: RequestOptions,
  ): Promise<ClientResult<RouteResponse<M, P>>> {
    const route = findRoute(method, path);
    if (route.request) {
      const checked = route.request.safeParse(body);
      if (!checked.success) {
        throw new ApiError({
          code: "VALIDATION_FAILED",
          message: `Zahtjev ne odgovara ugovoru (${method} ${path}).`,
          status: 0,
          raw: checked.error.issues,
        });
      }
    }
    return call(method, path, body, params, requestOptions);
  }

  return {
    get: <P extends string>(path: P, params?: Record<string, string>, requestOptions?: RequestOptions) =>
      call("GET", path, undefined, params, requestOptions),
    post: <P extends string>(
      path: P,
      body: RouteRequest<"POST", P>,
      params?: Record<string, string>,
      requestOptions?: RequestOptions,
    ) => send("POST", path, body, params, requestOptions),
    patch: <P extends string>(
      path: P,
      body: RouteRequest<"PATCH", P>,
      params?: Record<string, string>,
      requestOptions?: RequestOptions,
    ) => send("PATCH", path, body, params, requestOptions),
  };
}

export type GradixClient = ReturnType<typeof createClient>;

export type { z };

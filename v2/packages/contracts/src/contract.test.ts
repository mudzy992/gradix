/**
 * Testovi ugovora. Tri stvari se provjeravaju, i svaka je nekad tiho pukla u praksi:
 *
 * 1. **Svaka ruta u aplikaciji ima ulaz u ugovoru** i obratno. Čita `apps/web/src/app/api`.
 *    Bez ovoga nova ruta živi bez ugovora, a klijent je ne vidi.
 * 2. **Katalog kodova je isti** kao u `apps/web/src/server/api.ts`. Dva spiska = dvije istine.
 * 3. **Primjeri odgovora prolaze šemu** — da šema nije samo dokumentacija.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERROR_STATUS } from "./envelope";
import { buildOpenApi } from "./openapi";
import { ROUTES } from "./routes";
import {
  AuditResponse,
  ForemanWorkersResponse,
  LoginResponse,
  MeResponse,
  RolesResponse,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  UsersResponse,
} from "./schemas";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const apiRoot = join(repoRoot, "apps/web/src/app/api");

/** Sve `route.ts` u aplikaciji → `{method, path}` (Next konvencija `[id]` → `{id}`). */
function appRoutes(): { method: string; path: string }[] {
  const found: { method: string; path: string }[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, [...segments, entry]);
      } else if (entry === "route.ts") {
        const source = readFileSync(full, "utf8");
        const path = `/api/${segments.map((segment) => segment.replace(/^\[(\w+)\]$/, "{$1}")).join("/")}`;
        for (const match of source.matchAll(
          /export (?:async )?function (GET|POST|PATCH|PUT|DELETE)\b/g,
        )) {
          found.push({ method: match[1]!, path });
        }
      }
    }
  };
  walk(apiRoot, []);
  return found.sort((a, b) =>
    `${a.path}${a.method}`.localeCompare(`${b.path}${b.method}`),
  );
}

const contractRoutes = ROUTES.map((route) => ({
  method: route.method,
  path: route.path,
})).sort((a, b) =>
  `${a.path}${a.method}`.localeCompare(`${b.path}${b.method}`),
);

describe("ugovor pokriva aplikaciju", () => {
  it("svaka ruta u aplikaciji ima ulaz u ugovoru", () => {
    const known = new Set(
      contractRoutes.map((route) => `${route.method} ${route.path}`),
    );
    const missing = appRoutes().filter(
      (route) => !known.has(`${route.method} ${route.path}`),
    );
    expect(
      missing,
      `Rute bez ugovora: ${missing.map((r) => `${r.method} ${r.path}`).join(", ")}`,
    ).toEqual([]);
  });

  it("nema ulaza u ugovoru bez rute u aplikaciji", () => {
    const actual = new Set(
      appRoutes().map((route) => `${route.method} ${route.path}`),
    );
    const stale = contractRoutes.filter(
      (route) => !actual.has(`${route.method} ${route.path}`),
    );
    expect(
      stale,
      `Ugovor ima rute kojih nema: ${stale.map((r) => `${r.method} ${r.path}`).join(", ")}`,
    ).toEqual([]);
  });

  it("svaka ruta ima jedinstven operationId u OpenAPI-ju", () => {
    const doc = buildOpenApi() as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    const ids = Object.values(doc.paths).flatMap((methods) =>
      Object.values(methods).map((operation) => operation.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("katalog kodova je jedan", () => {
  it("aplikacija ne drži svoju kopiju kataloga, nego koristi ugovor", () => {
    const source = readFileSync(
      join(repoRoot, "apps/web/src/server/api.ts"),
      "utf8",
    );
    // Druga kopija spiska je najtiši način da se server i klijent raziđu: ruta vrati kod
    // kojeg klijent ne poznaje i ekran pokaže „nepoznata greška“.
    expect(source).not.toMatch(/export const ERROR_CODES = \[/);
    expect(source).toContain('from "@gradix/contracts"');
  });

  it("svaki kod ima HTTP status", () => {
    for (const code of ERROR_CODES)
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
  });
});

describe("šeme prihvataju stvarne odgovore", () => {
  it("GET /api/me", () => {
    const sample = {
      user: {
        id: "usr_1",
        email: "ured@demo.ba",
        firstName: "Amina",
        lastName: "Karić",
        roles: ["ADMIN"],
        mustChangePassword: false,
      },
      company: {
        id: "cmp_demo",
        name: "Demo gradnja",
        slug: "demo",
        currency: "BAM",
        timezone: "Europe/Sarajevo",
      },
      machineCount: 3,
    };
    expect(MeResponse.parse(sample)).toEqual(sample);
  });

  it("GET /api/users", () => {
    const sample = {
      users: [
        {
          id: "usr_1",
          email: "ured@demo.ba",
          firstName: "Amina",
          lastName: "Karić",
          isActive: true,
          mustChangePassword: false,
          roles: ["ADMIN"],
          scope: "COMPANY",
          createdAt: "2026-11-08T09:00:00.000Z",
        },
      ],
    };
    expect(UsersResponse.parse(sample)).toEqual(sample);
  });

  it("POST /api/auth/login", () => {
    const sample = {
      user: { id: "usr_1", displayName: "Amina Karić", roles: ["ADMIN"] },
      companyId: "cmp_demo",
      mustChangePassword: false,
      accessToken: "a.b.c",
      refreshToken: "r1.r2",
      passwordPolicy: "min 10 znakova, slovo i broj",
    };
    expect(LoginResponse.parse(sample)).toEqual(sample);
  });

  it("GET /api/roles", () => {
    const sample = {
      permissions: [
        {
          key: "users.manage",
          label: "Upravljanje korisnicima",
          description: "…",
        },
      ],
      roles: [
        {
          role: "ADMIN",
          label: "Administrator",
          description: "…",
          permissions: ["users.manage"],
          assignableBy: ["OWNER"],
        },
      ],
      editable: false,
    };
    expect(RolesResponse.parse(sample)).toEqual(sample);
  });

  it("GET /api/audit", () => {
    const sample = {
      rows: [
        {
          id: "aud_1",
          action: "user.invited",
          entityType: "invitation",
          entityId: "inv_1",
          actorId: "usr_1",
          actorEmail: "ured@demo.ba",
          metadata: { roles: ["WORKER"] },
          createdAt: "2026-11-08T09:00:00.000Z",
        },
      ],
      nextCursor: null,
    };
    expect(AuditResponse.parse(sample)).toEqual(sample);
  });

  it("GET /api/sync/pull returns a scoped R4 event page and opaque cursors", () => {
    const sample = {
      events: [{
        id: "evt_1",
        cursorSeq: "1",
        entityType: "work_entry",
        entityId: "we_1",
        entityVersion: 1,
        payload: { workdayId: "wd_1", kind: "WORK", workerName: "Amina K." },
        tombstone: false,
        createdAt: "2026-11-08T09:00:00.000Z",
      }],
      cursor: "signed-opaque-cursor",
      cursorFloor: "signed-opaque-floor",
      hasMore: false,
    };
    expect(SyncPullResponse.parse(sample)).toEqual(sample);
  });

  it("foreman worker pull carries only worker ID and display name", () => {
    const sample = {
      workDate: "2026-11-09",
      workers: [{ id: "worker_1", name: "Amina K." }],
    };
    expect(ForemanWorkersResponse.parse(sample)).toEqual(sample);
    expect(ForemanWorkersResponse.safeParse({
      ...sample,
      workers: [{ ...sample.workers[0], phone: "+38760000000", email: "private@test.example" }],
    }).success).toBe(false);
  });

  it("POST /api/sync/push accepts only the strict R4 item protocol", () => {
    const valid = {
      items: [{
        localId: "00000000-0000-4000-8000-000000000001",
        entityType: "work_entry",
        workdayId: "00000000-0000-4000-8000-000000000003",
        workEntryId: "00000000-0000-4000-8000-000000000002",
        deviceSentAt: "2026-11-07T10:00:00+01:00",
        entry: {
          kind: "WORK",
          startedAt: "2026-11-07T08:00:00+01:00",
          endedAt: "2026-11-07T09:00:00+01:00",
          endState: "KNOWN_END",
          projectId: "project_1",
          machineId: null,
          note: null,
        },
      }],
    };
    expect(SyncPushRequest.parse(valid)).toEqual(valid);
    expect(SyncPushRequest.safeParse({
      deviceId: "old-device",
      items: [{ localId: "old", entityType: "note", payload: { text: "R0" }, clientAt: "2026-11-07T10:00:00Z" }],
    }).success).toBe(false);
  });

  it("POST /api/sync/push returns per-item R4 outcomes, not the R0 note receipt", () => {
    const sample = {
      results: [{
        localId: "00000000-0000-4000-8000-000000000001",
        status: "APPLIED",
        entityId: "00000000-0000-4000-8000-000000000002",
        version: 1,
        cursor: "signed-opaque-cursor",
        canonicalWorkdayId: "00000000-0000-4000-8000-000000000003",
      }],
    };
    expect(SyncPushResponse.parse(sample)).toEqual(sample);
  });
});

describe("OpenAPI", () => {
  it("svaka ruta ima 200 i bar jednu grešku", () => {
    const doc = buildOpenApi() as {
      paths: Record<
        string,
        Record<string, { responses: Record<string, unknown> }>
      >;
    };
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(
          Object.keys(operation.responses),
          `${method.toUpperCase()} ${path}`,
        ).toContain("200");
        expect(
          Object.keys(operation.responses).length,
          `${method.toUpperCase()} ${path}`,
        ).toBeGreaterThan(1);
      }
    }
  });

  it("rute koje traže sesiju imaju 401, a javne nemaju", () => {
    const doc = buildOpenApi() as {
      paths: Record<
        string,
        Record<string, { responses: Record<string, unknown> }>
      >;
    };
    for (const route of ROUTES) {
      const responses =
        doc.paths[route.path]![route.method.toLowerCase()]!.responses;
      expect("401" in responses, `${route.method} ${route.path}`).toBe(
        route.auth,
      );
    }
  });

  it("nema ugniježđenog $schema", () => {
    expect(JSON.stringify(buildOpenApi())).not.toContain('"$schema"');
  });
});

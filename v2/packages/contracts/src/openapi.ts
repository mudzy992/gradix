/**
 * OpenAPI 3.1 iz istih šema koje koristi klijent — bez ručnog YAML-a.
 *
 * Zod 4 ima ugrađen `toJSONSchema`, pa nema dodatne zavisnosti. Ono što Zod ne zna samo su
 * `paths` i dijeljeni odgovori; to se sklapa iz `ROUTES` i `ERROR_CODES`, pa se ni spisak ruta
 * ni spisak kodova ne može razići sa klijentom.
 */
import { z } from "zod";
import { ERROR_CODES, ERROR_STATUS, type ErrorCode } from "./envelope";
import { ROUTES, type RouteSpec } from "./routes";

/** U OpenAPI 3.1 šema je čvor bez svog `$schema` — dokument ga nosi jednom. */
const strip = (node: Record<string, unknown>): Record<string, unknown> => {
  const { $schema: _ignored, ...rest } = node;
  return rest;
};

const jsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  strip(
    z.toJSONSchema(schema, { io: "output", target: "draft-2020-12" }) as Record<
      string,
      unknown
    >,
  );

const inputSchema = (schema: z.ZodType): Record<string, unknown> =>
  strip(
    z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" }) as Record<
      string,
      unknown
    >,
  );

const envelopeSchema = (
  data: Record<string, unknown>,
): Record<string, unknown> => ({
  type: "object",
  required: ["success", "data"],
  properties: {
    success: { const: true },
    data,
    meta: { type: "object", additionalProperties: true },
  },
});

const failureSchema: Record<string, unknown> = {
  type: "object",
  required: ["success", "error"],
  properties: {
    success: { const: false },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", enum: [...ERROR_CODES] },
        message: { type: "string" },
      },
    },
  },
};

/** Statusi koje ruta može vratiti — iz kataloga kodova, ne iz mašte. */
function failureStatuses(auth: boolean): number[] {
  const base = [400, 403, 404, 409, 429, 500];
  return auth ? [401, ...base] : base;
}

function queryParameters(
  query: z.ZodObject | undefined,
): Record<string, unknown>[] {
  if (!query) return [];
  const shape = z.toJSONSchema(query, {
    io: "input",
    target: "draft-2020-12",
  }) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  return Object.entries(shape.properties ?? {}).map(([name, schema]) => ({
    name,
    in: "query",
    required: (shape.required ?? []).includes(name),
    schema,
  }));
}

function pathParameters(path: string): Record<string, unknown>[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
}

export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  // `RouteSpec[]` je namjerno: registar je `as const` (zbog doslovnih putanja u tipovima), pa
  // opciona polja (`raw`, `query`, `meta`) ne postoje na svakom članu unije. Ovako se čitaju
  // sa istim tipom, a doslovne putanje ostaju u `RouteMap`.
  for (const route of ROUTES as readonly RouteSpec[]) {
    const operation: Record<string, unknown> = {
      operationId: `${route.method.toLowerCase()}_${route.path
        .replace(/^\/api\//, "")
        .replace(/[{}]/g, "")
        .replace(/\//g, "_")}`,
      summary: route.summary,
      tags: [route.path.split("/")[2] ?? "api"],
      security: route.auth ? [{ cookieAuth: [] }, { bearerAuth: [] }] : [],
      responses: {
        "200": {
          description: "Uspjeh",
          content: {
            "application/json": {
              schema: route.raw
                ? jsonSchema(route.response)
                : envelopeSchema(jsonSchema(route.response)),
            },
          },
        },
        ...Object.fromEntries(
          failureStatuses(route.auth)
            .filter((status) =>
              ERROR_CODES.some((code) => ERROR_STATUS[code] === status),
            )
            .map((status) => [
              String(status),
              {
                description: "Greška",
                content: { "application/json": { schema: failureSchema } },
              },
            ]),
        ),
      },
    };

    if (route.permission) {
      operation.description = `Traži dozvolu \`${route.permission}\`.`;
    }

    const parameters = [
      ...pathParameters(route.path),
      ...queryParameters(route.query),
    ];
    if (parameters.length > 0) operation.parameters = parameters;

    if (route.request) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: inputSchema(route.request) } },
      };
    } else if (route.contentType === "multipart/form-data") {
      // Uvoz nosi sam fajl; šeme polja su u `schemas.ts`, a tijelo je `FormData`.
      operation.requestBody = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["kind", "file"],
              properties: {
                kind: { type: "string", enum: ["workers", "equipment"] },
                file: { type: "string", format: "binary" },
                mapping: {
                  type: "string",
                  description: "JSON mapa polje→kolona (opciono)",
                },
                decisions: {
                  type: "string",
                  description: "JSON odluka po redu (samo `apply`)",
                },
              },
            },
          },
        },
      };
    }

    paths[route.path] = {
      ...(paths[route.path] ?? {}),
      [route.method.toLowerCase()]: operation,
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Gradix API",
      version: "r1",
      description:
        "Ugovor između servera i klijenata. Generisan iz `packages/contracts/src/schemas.ts`; " +
        "ne uređivati ručno. Provjera ažurnosti: `pnpm --filter @gradix/contracts check`.",
    },
    servers: [{ url: "/" }],
    paths,
    components: {
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "gx_access" },
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        Error: failureSchema,
        ErrorCode: { type: "string", enum: [...ERROR_CODES] },
      },
    },
    "x-error-status": Object.fromEntries(
      ERROR_CODES.map((code: ErrorCode) => [code, ERROR_STATUS[code]]),
    ),
  };
}

export default buildOpenApi;

/**
 * Upisuje `openapi.json` iz šema. Pokreće se ručno kad se ugovor promijeni:
 * `pnpm --filter @gradix/contracts openapi`.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApi } from "../src/openapi";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "..", "openapi.json");
const document = buildOpenApi();
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
const paths = Object.keys(document.paths as Record<string, unknown>).length;
console.log(`openapi.json: ${paths} putanja`);

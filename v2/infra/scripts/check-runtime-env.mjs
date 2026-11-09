import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const v2Root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (path) => readFileSync(resolve(v2Root, path), "utf8");
const storage = read("apps/web/src/server/storage.ts");
const diagnostics = read("infra/diagnostics/run.mjs");
const compose = read("infra/coolify/docker-compose.yml");
const envExample = read(".env.example");

const source = `${storage}\n${diagnostics}`;
const referencedNames = new Set();
for (const match of source.matchAll(/\b(?:process\.env|env)\.([A-Z][A-Z0-9_]*)/g)) referencedNames.add(match[1]);

const webSection = compose.match(/^  web:\n([\s\S]*?)(?=^  minio:\n)/m)?.[1];
if (!webSection) throw new Error("Could not locate the Coolify web service in docker-compose.yml.");
const webEnvironment = webSection.split(/^    volumes:\s*$/m, 1)[0];
const configuredNames = new Set(
  [...webEnvironment.matchAll(/^\s{6}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1]),
);
const missing = [...referencedNames].filter((name) => !configuredNames.has(name)).sort();
if (missing.length) throw new Error(`Code-read environment names missing from Coolify web service: ${missing.join(", ")}`);

if (/^\s{6}MINIO_(?:ROOT_USER|ROOT_PASSWORD|DATA_DIR):/m.test(webEnvironment)) {
  throw new Error("MinIO server credentials/data variables must not be injected into the web app service.");
}
if (/REDIS_CA_FILE/.test(compose) || /REDIS_CA_FILE/.test(envExample) || /REDIS_CA_FILE/.test(source)) {
  throw new Error("Use only REDIS_TLS_CA_FILE; duplicate REDIS_CA_FILE must be removed.");
}
if (!/REDIS_PREFIX:\s*\$\{REDIS_PREFIX:-gradix:stg:\}/.test(webEnvironment)) {
  throw new Error("Staging Redis prefix must default to gradix:stg:.");
}
if (!/^\s{6}MINIO_BUCKET:\s*gradix-stg\s*$/m.test(webEnvironment)) {
  throw new Error("Staging app bucket must be gradix-stg.");
}
if (!/^\s{6}MINIO_ENDPOINT:\s*\$\{MINIO_ENDPOINT:-http:\/\/minio:9000\}\s*$/m.test(webEnvironment)) {
  throw new Error("Staging app must use same-stack MinIO DNS at http://minio:9000 by default.");
}
if (!/^\s{6}REDIS_TLS_CA_FILE:\s*\$\{REDIS_TLS_CA_FILE:-\/etc\/ssl\/certs\/redis\/redis-ca\.crt\}\s*$/m.test(webEnvironment)) {
  throw new Error("REDIS_TLS_CA_FILE must point to the mounted staging CA in the app container.");
}
if (!/source:\s*\/data\/coolify\/ssl\/redis-core\s+target:\s*\/etc\/ssl\/certs\/redis\s+read_only:\s*true/.test(webSection)) {
  throw new Error("Redis CA host directory must be mounted read-only at /etc/ssl/certs/redis in the web container.");
}
if (!/^REDIS_TLS_CA_FILE=.*\/etc\/ssl\/certs\/redis\/redis-ca\.crt/m.test(envExample)) {
  throw new Error(".env.example must document the mounted Redis CA container path.");
}
if (!/gradix-stg-minio-data/.test(compose) || /^\s{6}MINIO_DATA_DIR:/m.test(webEnvironment)) {
  throw new Error("Staging MinIO must use its own volume; MINIO_DATA_DIR must not be an app variable.");
}

console.log(`Coolify env contract OK; code-read names: ${[...referencedNames].sort().join(", ")}`);
console.log("Staging isolation OK: Redis prefix gradix:stg:, MinIO bucket/volume gradix-stg, no Redis CA duplicate or MinIO server vars in web.");

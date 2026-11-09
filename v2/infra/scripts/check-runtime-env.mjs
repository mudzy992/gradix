import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const v2Root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (path) => readFileSync(resolve(v2Root, path), "utf8");
const storage = read("apps/web/src/server/storage.ts");
const diagnostics = read("infra/diagnostics/run.mjs");
const compose = read("infra/coolify/docker-compose.yml");
const envExample = read(".env.example");
const redisAcl = read("infra/redis/acl-v2.txt");

const source = `${storage}\n${diagnostics}`;
if (!/rejectUnauthorized:\s*true/.test(diagnostics) || /rejectUnauthorized:\s*false/.test(diagnostics)) {
  throw new Error("Redis TLS certificate verification must remain enabled.");
}
const referencedNames = new Set();
for (const match of source.matchAll(/\b(?:process\.env|env)\.([A-Z][A-Z0-9_]*)/g)) referencedNames.add(match[1]);

const webSection = compose.match(/^ {2}web:\n([\s\S]*?)(?=^ {2}minio:\n)/m)?.[1];
const minioSection = compose.match(/^ {2}minio:\n([\s\S]*?)(?=^ {2}minio-init:\n)/m)?.[1];
if (!webSection) throw new Error("Could not locate the Coolify web service in docker-compose.yml.");
if (!minioSection) throw new Error("Could not locate the Coolify MinIO service in docker-compose.yml.");

const webEnvironment = webSection.split(/^ {4}volumes:\s*$/m, 1)[0];
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
if (!/REDIS_USER:\s*\$\{REDIS_USER:-gradix_v2\}/.test(webEnvironment)) {
  throw new Error("Staging Redis user must default to the existing ACL user gradix_v2.");
}
if (!/^\s{6}MINIO_BUCKET:\s*gradix-stg\s*$/m.test(webEnvironment)) {
  throw new Error("Staging app bucket must be gradix-stg.");
}
if (!/^\s{6}MINIO_ENDPOINT:\s*\$\{MINIO_ENDPOINT:-http:\/\/minio:9000\}\s*$/m.test(webEnvironment)) {
  throw new Error("Staging app must use same-stack MinIO DNS at http://minio:9000 by default.");
}
if (!/^\s{6}REDIS_TLS_CA_FILE:\s*\$\{REDIS_TLS_CA_FILE:-\/etc\/ssl\/certs\/redis\/redis-ca\.crt\}\s*$/m.test(webEnvironment)) {
  throw new Error("REDIS_TLS_CA_FILE fallback must match the mounted Redis CA file path.");
}
if (!/source:\s*\/data\/coolify\/ssl\/redis-core\s+target:\s*\/etc\/ssl\/certs\/redis\s+read_only:\s*true\s+bind:\s+create_host_path:\s*true/.test(webSection)) {
  throw new Error("Redis CA directory must be mounted read-only at /etc/ssl/certs/redis in the web container.");
}
if (!/^REDIS_TLS_CA_FILE=.*\/etc\/ssl\/certs\/redis\/redis-ca\.crt/m.test(envExample)) {
  throw new Error(".env.example must document the mounted Redis CA container path.");
}
if (!/^ACL GETUSER gradix_v2$/m.test(redisAcl) || /^\s*ACL SETUSER\b/im.test(redisAcl)) {
  throw new Error("Redis ACL file must audit the existing gradix_v2 user without mutating it.");
}
if (!/key pattern:\s*~gradix:stg:\*/i.test(redisAcl) || !/commands:\s*\+ping \+set \+pttl \+get \+del/i.test(redisAcl)) {
  throw new Error("Redis ACL audit contract must match the staging prefix and diagnostic commands.");
}
if (!/^\s{4}image:\s*ghcr\.io\/coollabsio\/minio:latest\s*$/m.test(minioSection)) {
  throw new Error("Staging MinIO image must be ghcr.io/coollabsio/minio:latest.");
}
if (!/source:\s*\/mnt\/shared-app-files\/gradix-v2\/minio\s+target:\s*\/data\s+bind:\s+create_host_path:\s*false/.test(minioSection)) {
  throw new Error("Staging MinIO /data must persist at /mnt/shared-app-files/gradix-v2/minio without creating an empty host path.");
}
if (/gradix_stg_minio_data|gradix-stg-minio-data/.test(compose)) {
  throw new Error("Coolify MinIO must use the required host bind, not the former named volume.");
}
if (!/MINIO_DATA_DIR.*\/mnt\/shared-app-files\/gradix-v2\/minio/.test(envExample)) {
  throw new Error(".env.example must document the persistent MinIO host data path.");
}

console.log(`Coolify env contract OK; code-read names: ${[...referencedNames].sort().join(", ")}`);
console.log("Staging isolation OK: Redis user gradix_v2, prefix gradix:stg:, read-only CA bind with TLS verification, MinIO bucket gradix-stg and host path /mnt/shared-app-files/gradix-v2/minio; ACL audit is read-only.");

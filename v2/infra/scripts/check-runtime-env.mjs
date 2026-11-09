import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const v2Root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (path) => readFileSync(resolve(v2Root, path), "utf8");
const storage = read("apps/web/src/server/storage.ts");
const diagnostics = read("infra/diagnostics/run.mjs");
const compose = read("infra/coolify/docker-compose.yml");
const webDockerfile = read("infra/docker/Dockerfile.web");
const minioInitDockerfile = read("infra/minio/Dockerfile.init");
const envExample = read(".env.example");
const redisAcl = read("infra/redis/acl-v2.txt");
const minioInitScript = read("infra/minio/init-staging.sh");

const source = `${storage}\n${diagnostics}`;
if (!/rejectUnauthorized:\s*true/.test(diagnostics) || /rejectUnauthorized:\s*false/.test(diagnostics)) {
  throw new Error("Redis TLS certificate verification must remain enabled.");
}
const referencedNames = new Set();
for (const match of source.matchAll(/\b(?:process\.env|env)\.([A-Z][A-Z0-9_]*)/g)) referencedNames.add(match[1]);

const webSection = compose.match(/^ {2}web:\n([\s\S]*?)(?=^ {2}minio:\n)/m)?.[1];
const minioSection = compose.match(/^ {2}minio:\n([\s\S]*?)(?=^ {2}minio-init:\n)/m)?.[1];
const minioInitSection = compose.match(/^ {2}minio-init:\n([\s\S]*?)(?=^networks:\n)/m)?.[1];
if (!webSection) throw new Error("Could not locate the Coolify web service in docker-compose.yml.");
if (!minioSection) throw new Error("Could not locate the Coolify MinIO service in docker-compose.yml.");
if (!minioInitSection) throw new Error("Could not locate the MinIO bootstrap service in docker-compose.yml.");

const webEnvironment = webSection.split(/^ {4}volumes:\s*$/m, 1)[0];
const minioEnvironment = minioSection.split(/^ {4}volumes:\s*$/m, 1)[0];
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
if (/^(?:MINIO_ENDPOINT|MINIO_BUCKET|MINIO_REGION|REDIS_HOST|REDIS_PORT|REDIS_USER|REDIS_PREFIX|REDIS_TLS_CA_FILE)=/m.test(envExample)) {
  throw new Error("Fixed MinIO/Redis Compose defaults must not be overrideable through .env.example.");
}
if (!/^\s{6}MINIO_ENDPOINT:\s*http:\/\/minio:9000\s*$/m.test(webEnvironment) ||
    !/^\s{6}MINIO_BUCKET:\s*gradix-stg\s*$/m.test(webEnvironment) ||
    !/^\s{6}MINIO_REGION:\s*us-east-1\s*$/m.test(webEnvironment)) {
  throw new Error("Staging MinIO endpoint, bucket, and region must use the fixed Compose defaults.");
}
if (!/^\s{6}REDIS_HOST:\s*redis-core\s*$/m.test(webEnvironment) ||
    !/^\s{6}REDIS_PORT:\s*"6380"\s*$/m.test(webEnvironment) ||
    !/^\s{6}REDIS_USER:\s*gradix_v2\s*$/m.test(webEnvironment) ||
    !/^\s{6}REDIS_PREFIX:\s*"gradix:stg:"\s*$/m.test(webEnvironment)) {
  throw new Error("Staging Redis endpoint, existing ACL user, and namespace must match the repository ACL.");
}
if (!/^\s{6}REDIS_TLS_CA_FILE:\s*\/run\/secrets\/redis-ca\.crt\s*$/m.test(webEnvironment)) {
  throw new Error("REDIS_TLS_CA_FILE must use the mounted /run/secrets/redis-ca.crt path.");
}
if (!/source:\s*\/data\/coolify\/ssl\/redis-core\/redis-ca\.crt\s+target:\s*\/run\/secrets\/redis-ca\.crt\s+read_only:\s*true\s+bind:\s+create_host_path:\s*false/.test(webSection)) {
  throw new Error("Redis CA file must be mounted read-only at /run/secrets/redis-ca.crt; missing host cert must fail deploy.");
}
if (!/mkdir -p \/run\/secrets/.test(webDockerfile)) {
  throw new Error("Web image must create /run/secrets before mounting the Redis CA file.");
}
if (!/^REDIS_PASSWORD=/m.test(envExample)) {
  throw new Error(".env.example must retain the existing Redis ACL password as a secret-only input.");
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
if (!/MINIO_ROOT_USER:\s*\$\{MINIO_ROOT_USER:\?Set MINIO_ROOT_USER in Coolify\}/.test(minioEnvironment) ||
    !/MINIO_ROOT_PASSWORD:\s*\$\{MINIO_ROOT_PASSWORD:\?Set MINIO_ROOT_PASSWORD in Coolify\}/.test(minioEnvironment)) {
  throw new Error("MinIO root secrets must be required; the server must not start with minioadmin defaults.");
}
if (!/^\s{6}MINIO_API_CORS_ALLOW_ORIGIN:\s*\$\{MINIO_CORS_ALLOWED_ORIGIN:-https:\/\/gradix\.ba101\.top\}\s*$/m.test(minioEnvironment)) {
  throw new Error("MinIO server must receive the exact web origin via its global API CORS allowlist.");
}
const minioExpose = minioSection.match(/^ {4}expose:\n((?:^ {6}.*\n?)*)/m)?.[1] ?? "";
if (!/^\s{6}- "9000"(?:\s|$)/m.test(minioExpose) || !/^\s{6}- "9001"(?:\s|$)/m.test(minioExpose)) {
  throw new Error("MinIO must expose S3 API port 9000 and Console port 9001 to the Coolify proxy network.");
}
if (/^ {4}ports:/m.test(minioSection)) {
  throw new Error("MinIO ports must not be published directly on the host; use separate Coolify domain routes.");
}
if (!/^\s{6}SERVICE_FQDN_MINIO:\s*\$\{SERVICE_FQDN_MINIO:-\}\s*$/m.test(minioEnvironment) ||
    !/^\s{6}SERVICE_FQDN_MINIO_9001:\s*\$\{SERVICE_FQDN_MINIO_9001:-https:\/\/minio-console\.gradix\.ba101\.top\}\s*$/m.test(minioEnvironment) ||
    !/^\s{6}MINIO_BROWSER_REDIRECT_URL:\s*\$\{MINIO_BROWSER_REDIRECT_URL:-https:\/\/minio-console\.gradix\.ba101\.top\}\s*$/m.test(minioEnvironment)) {
  throw new Error("MinIO API and Console must retain separate Coolify routing variables and the Console redirect URL.");
}
if (/^\s{6}MINIO_(?:ACCESS_KEY|SECRET_KEY):/m.test(minioEnvironment)) {
  throw new Error("App MinIO credentials must not be passed to the MinIO server process.");
}
if (!/source:\s*\/mnt\/shared-app-files\/gradix-v2\/minio\s+target:\s*\/data\s+bind:\s+create_host_path:\s*false/.test(minioSection)) {
  throw new Error("Staging MinIO /data must persist at /mnt/shared-app-files/gradix-v2/minio without creating an empty host path.");
}
if (!/dockerfile:\s*infra\/minio\/Dockerfile\.init/.test(minioInitSection) || /entrypoint:/i.test(minioInitSection)) {
  throw new Error("MinIO init must use the custom shell image; do not override its baked-in entrypoint.");
}
if (!/^FROM quay\.io\/minio\/aistor\/mc:RELEASE\.2025-12-19T20-11-44Z$/m.test(minioInitDockerfile) ||
    !/COPY infra\/minio\/init-staging\.sh \/init\.sh/.test(minioInitDockerfile) ||
    !/COPY infra\/minio\/staging-policy\.json \/policy\.json/.test(minioInitDockerfile) ||
    !/ENTRYPOINT \["\/bin\/bash", "\/init\.sh"\]/.test(minioInitDockerfile)) {
  throw new Error("MinIO init image must use the pinned official Quay mc image and its baked-in bash entrypoint.");
}
if (!/^#!\/bin\/bash/.test(minioInitScript) ||
    !/MINIO_ACCESS_KEY must differ from MINIO_ROOT_USER/.test(minioInitScript) ||
    !/MINIO_ACCESS_KEY is too short/.test(minioInitScript) ||
    !/MINIO_SECRET_KEY is too short/.test(minioInitScript) ||
    !/redact_credentials/.test(minioInitScript) ||
    !/run_mc_or_explain/.test(minioInitScript) ||
    /mc cors set|CORSConfiguration/.test(minioInitScript) ||
    /MINIO_CORS_ALLOWED_ORIGIN:/.test(minioInitSection)) {
  throw new Error("MinIO init must validate app-user inputs; bucket CORS API must not be called because this server does not implement it.");
}
if (/gradix_stg_minio_data|gradix-stg-minio-data/.test(compose)) {
  throw new Error("Coolify MinIO must use the required host bind, not the former named volume.");
}
for (const name of ["MINIO_PUBLIC_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD", "MINIO_CORS_ALLOWED_ORIGIN"]) {
  if (!new RegExp(`^${name}=`, "m").test(envExample)) throw new Error(`.env.example must retain configurable MinIO input ${name}.`);
}

console.log(`Coolify env contract OK; code-read names: ${[...referencedNames].sort().join(", ")}`);
console.log("Staging defaults OK: fixed MinIO/Redis contracts, server-wide MinIO API CORS, separate API/Console routes, shell-enabled mc init, required MinIO root secrets and persistent host bind.");

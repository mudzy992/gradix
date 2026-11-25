#!/usr/bin/env node
/** CI fault-injection checks for the optional, secret-safe runtime diagnostics. */
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const diagnostic = fileURLToPath(new URL("./run.mjs", import.meta.url));
const names = [
  "REDIS_HOST", "REDIS_PORT", "REDIS_USER", "REDIS_PASSWORD", "REDIS_PREFIX", "REDIS_TLS_CA_FILE",
  "MINIO_ENDPOINT", "MINIO_PUBLIC_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_BUCKET",
  "MINIO_REGION", "MINIO_CORS_ALLOWED_ORIGIN",
];

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const name of names) env[name] = "";
  Object.assign(env, overrides);
  return env;
}

function runDiagnostic(env, timeoutMs = 11_500) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [diagnostic], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) reject(new Error(`diagnostic exceeded ${timeoutMs}ms (signal ${signal})\n${stdout}\n${stderr}`));
      else resolve({ code, output: `${stdout}${stderr}` });
    });
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function main() {
  const noConfig = await runDiagnostic(cleanEnv());
  assert.equal(noConfig.code, 0, noConfig.output);
  assert.match(noConfig.output, /phase=redis\.config status=SKIP cause=redis_host_not_configured/);
  assert.match(noConfig.output, /phase=s3\.config status=SKIP cause=s3_not_configured/);
  assert.doesNotMatch(noConfig.output, /https?:\/\/[^\s"']+:[^\s"']+@/i);

  let redisCommandReceived = false;
  const redis = createServer((socket) => {
    socket.on("data", () => {
      redisCommandReceived = true;
      socket.write("-WRONGPASS invalid username-password pair or user is disabled.\r\n");
    });
  });
  const redisPort = await listen(redis);
  const redisSecret = "ci-redis-password-must-not-appear";
  try {
    const noPassword = await runDiagnostic(cleanEnv({
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: String(redisPort),
      REDIS_USER: "gradix_v2",
      REDIS_PREFIX: "gradix:stg:",
    }));
    assert.equal(noPassword.code, 0, noPassword.output);
    assert.match(noPassword.output, /phase=redis\.auth_rw status=SKIP cause=redis_password_not_configured/);
    assert.equal(redisCommandReceived, false, "Redis commands were sent without an ACL password");

    const badPassword = await runDiagnostic(cleanEnv({
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: String(redisPort),
      REDIS_USER: "ci-user",
      REDIS_PASSWORD: redisSecret,
      REDIS_PREFIX: "gradix:stg:",
    }));
    assert.equal(badPassword.code, 0, badPassword.output);
    assert.match(badPassword.output, /phase=redis\.auth_rw status=FAIL cause=redis_auth_or_acl_failed/);
    assert.match(badPassword.output, /WRONGPASS/);
    assert.match(badPassword.output, /failed_command='AUTH'/);
    assert.match(badPassword.output, /key_pattern='gradix:stg:diag:\*'/);
    assert.match(badPassword.output, /prefix='gradix:stg:diag:'/);
    assert.ok(!badPassword.output.includes(redisSecret), "Redis password leaked to diagnostic output");
  } finally {
    await close(redis);
  }

  /*
   * ACL sa `+ping` bez `+set`: ranije je `redis.auth_rw` padao kao `FAIL (NOPERM)` iako
   * aplikacija Redis ne koristi. Sada AUTH+PING daju PASS, a upis se uopšte ne šalje.
   */
  let writeAttempted = false;
  /*
   * ACL sa `+ping` bez `+set`: ranije je `redis.auth_rw` padao kao `FAIL (NOPERM)` iako aplikacija
   * Redis ne koristi. Sada AUTH+PING daju PASS, a upis se uopšte ne šalje.
   *
   * Server govori RESP (niz bulk stringova `*3\r\n$4\r\nAUTH…`), pa se komande čitaju po okviru;
   * linijski parser bi `AUTH` prepoznao kao `*3` i vratio NOPERM — lažni pad.
   */
  const pingOnlyRedis = createServer((socket) => {
    socket.on("error", () => undefined);
    let buffer = Buffer.alloc(0);
    const readLine = () => {
      const index = buffer.indexOf("\r\n");
      if (index === -1) return null;
      const line = buffer.subarray(0, index).toString("utf8");
      buffer = buffer.subarray(index + 2);
      return line;
    };
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const header = readLine();
        if (header === null) return;
        if (!header.startsWith("*")) return;
        const count = Number(header.slice(1));
        const parts = [];
        for (let index = 0; index < count; index += 1) {
          readLine(); // `$<len>` — dužina se ne koristi, čita se sljedeći red
          parts.push(readLine() ?? "");
        }
        const command = (parts[0] ?? "").toUpperCase();
        if (command === "SET") writeAttempted = true;
        socket.write(command === "PING" ? "+PONG\r\n" : command === "AUTH" ? "+OK\r\n" : "-NOPERM no permissions\r\n");
      }
    });
  });
  const pingOnlyPort = await listen(pingOnlyRedis);
  try {
    const pingOnly = await runDiagnostic(cleanEnv({
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: String(pingOnlyPort),
      REDIS_USER: "gradix_v2",
      REDIS_PASSWORD: "ci-ping-only-secret",
      REDIS_PREFIX: "gradix:stg:",
    }));
    assert.equal(pingOnly.code, 0, pingOnly.output);
    assert.match(pingOnly.output, /phase=redis\.auth_rw status=PASS cause=redis_auth_and_ping_ok_write_not_required/);
    assert.match(pingOnly.output, /prefixed_set='SKIP\(application_redis_usage=none; no write attempted\)'/);
    assert.equal(writeAttempted, false, "Redis SET was sent although the application does not use Redis");
  } finally {
    await close(pingOnlyRedis);
  }

  const missingCa = await runDiagnostic(cleanEnv({
    REDIS_HOST: "127.0.0.1",
    REDIS_PORT: "6380",
    REDIS_USER: "ci-user",
    REDIS_PASSWORD: "ci-ca-test-secret",
    REDIS_TLS_CA_FILE: "/definitely/not/a/real/gradix-redis-ca.crt",
  }));
  assert.equal(missingCa.code, 0, missingCa.output);
  assert.match(missingCa.output, /phase=redis\.config status=FAIL cause=ca_absent_in_container_likely_host_path_without_mount/);
  assert.ok(!missingCa.output.includes("ci-ca-test-secret"), "Redis secret leaked while reporting a missing CA");

  const minioSecret = "ci-minio-secret-must-not-appear";
  const missingBucket = createHttpServer((request, response) => {
    response.writeHead(404, { "content-type": "application/xml", "x-amz-bucket-region": "us-east-1" });
    response.end(request.method === "HEAD" ? undefined : "<Error><Code>NoSuchBucket</Code></Error>");
  });
  const minioPort = await listen(missingBucket);
  try {
    const missing = await runDiagnostic(cleanEnv({
      MINIO_ENDPOINT: `http://127.0.0.1:${minioPort}`,
      MINIO_ACCESS_KEY: "ci-access-key",
      MINIO_SECRET_KEY: minioSecret,
      MINIO_BUCKET: "gradix-missing-ci",
      MINIO_REGION: "us-east-1",
    }));
    assert.equal(missing.code, 0, missing.output);
    assert.match(missing.output, /phase=s3\.bucket_object status=FAIL cause=bucket_missing/);
    assert.ok(!missing.output.includes(minioSecret), "MinIO secret leaked to diagnostic output");
  } finally {
    await close(missingBucket);
  }

  /*
   * Bucket postoji, ali PUT pada sa `Error` (MinIO vraća to ime za sve S3 greške). Dijagnostika
   * mora ispisati stvarni status, S3 kod, putanju adresiranja i poruku — nikad samo `Error`.
   */
  const brokenPut = createHttpServer((request, response) => {
    if (request.method === "PUT") {
      response.writeHead(400, { "content-type": "application/xml" });
      response.end(
        "<Error><Code>XMinioInvalidObjectName</Code><Message>Object name contains unsupported characters.</Message></Error>",
      );
      return;
    }
    response.writeHead(200, { "content-type": "application/xml" });
    response.end("<ListBucketResult/>");
  });
  const brokenPutPort = await listen(brokenPut);
  try {
    const broken = await runDiagnostic(cleanEnv({
      MINIO_ENDPOINT: `http://127.0.0.1:${brokenPutPort}`,
      MINIO_ACCESS_KEY: "ci-access-key",
      MINIO_SECRET_KEY: minioSecret,
      MINIO_BUCKET: "gradix-stg",
      MINIO_REGION: "us-east-1",
    }));
    assert.equal(broken.code, 0, broken.output);
    assert.match(broken.output, /phase=s3\.bucket_object status=FAIL/);
    assert.match(broken.output, /http_status='400'/);
    assert.match(broken.output, /error_name='XMinioInvalidObjectName'/);
    assert.match(broken.output, /s3_error_code='XMinioInvalidObjectName'/);
    assert.match(broken.output, /error_message='Object name contains unsupported characters\.'/);
    assert.match(broken.output, /addressing_style='path_style'/);
    assert.match(broken.output, /addressing_force_path_style='true'/);
    assert.match(broken.output, /addressing_bucket_url='http:\/\/127\.0\.0\.1:\d+\/gradix-stg'/);
    assert.doesNotMatch(broken.output, /error_code='Error'/);
    assert.ok(!broken.output.includes(minioSecret), "MinIO secret leaked while reporting a broken PUT");
  } finally {
    await close(brokenPut);
  }

  /*
   * Sretna putanja + dokaz adresiranja: MinIO u Dockeru sluša na `minio:9000` i NE razumije
   * `<bucket>.minio:9000`. Test bilježi putanju koju SDK stvarno pogađa.
   */
  const paths = [];
  /* Dijagnostika provjerava da je pročitano tijelo identično poslanom, pa test pamti po ključu. */
  const stored = new Map();
  const workingS3 = createHttpServer((request, response) => {
    paths.push(`${request.method} ${request.url}`);
    const body = [];
    request.on("data", (chunk) => body.push(chunk));
    request.on("end", () => {
      const key = request.url ?? "/";
      if (request.method === "PUT") {
        stored.set(key, Buffer.concat(body));
        response.writeHead(200, { "content-type": "application/xml", etag: '"ci-etag"' });
        response.end();
        return;
      }
      const object = stored.get(key);
      if (request.method === "GET" && object) {
        response.writeHead(200, { "content-type": "image/png", "content-length": String(object.length) });
        response.end(object);
        return;
      }
      response.writeHead(200, { "content-type": "application/xml" });
      response.end("<ListBucketResult/>");
    });
  });
  const workingPort = await listen(workingS3);
  try {
    const working = await runDiagnostic(cleanEnv({
      MINIO_ENDPOINT: `http://127.0.0.1:${workingPort}`,
      MINIO_ACCESS_KEY: "ci-access-key",
      MINIO_SECRET_KEY: minioSecret,
      MINIO_BUCKET: "gradix-stg",
      MINIO_REGION: "us-east-1",
    }));
    assert.equal(working.code, 0, working.output);
    /*
     * Namjerno se NE traži `status=PASS`: AWS SDK šalje `aws-chunked` tijelo sa potpisom po
     * chunk-u, koje lažni MinIO ne može vratiti bajt-identično. Ono što ovdje dokazujemo je
     * ADRESIRANJE — da nijedan zahtjev ne ide na `<bucket>.host`.
     */
    /* SDK kodira `:` u `%3A`, a bucket mora ostati PRVI segment putanje. */
    assert.ok(
      paths.some((entry) => /^PUT \/gradix-stg\/gradix(%3A|:)/i.test(entry)),
      `PUT must be path-style (/bucket/key); saw: ${paths.join(", ")}`,
    );
    assert.ok(
      paths.every((entry) => /^(PUT|GET|HEAD|DELETE) \//.test(entry)),
      `no request may be virtual-host addressed; saw: ${paths.join(", ")}`,
    );
    assert.ok(!working.output.includes(minioSecret), "MinIO secret leaked on the successful path");
  } finally {
    await close(workingS3);
  }

  const nonexistent = await runDiagnostic(cleanEnv({
    MINIO_ENDPOINT: "http://gradix-minio-ci-probe-does-not-exist.invalid:9000",
    MINIO_ACCESS_KEY: "ci-access-key",
    MINIO_SECRET_KEY: "ci-host-test-secret",
    MINIO_BUCKET: "gradix-stg",
  }));
  assert.equal(nonexistent.code, 0, nonexistent.output);
  assert.match(nonexistent.output, /phase=s3\.connection status=FAIL cause=s3_dns_not_found_same_stack_network/);
  assert.ok(!nonexistent.output.includes("ci-host-test-secret"), "MinIO secret leaked during DNS failure");

  console.log("Diagnostics CI fault injection passed: missing Redis password skips commands, ping-only ACL needs no write, bad Redis auth, missing CA, missing bucket, path-style addressing with real S3 error details, absent DNS host; no test secrets were printed.");
}

await main();

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

  const redis = createServer((socket) => {
    socket.on("data", () => socket.write("-WRONGPASS invalid username-password pair or user is disabled.\r\n"));
  });
  const redisPort = await listen(redis);
  const redisSecret = "ci-redis-password-must-not-appear";
  try {
    const badPassword = await runDiagnostic(cleanEnv({
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: String(redisPort),
      REDIS_USER: "ci-user",
      REDIS_PASSWORD: redisSecret,
      REDIS_PREFIX: "gradix:stg:",
    }));
    assert.equal(badPassword.code, 0, badPassword.output);
    assert.match(badPassword.output, /phase=redis\.auth_rw status=FAIL cause=redis_auth_or_acl_failed/);
    assert.match(badPassword.output, /prefix='gradix:stg:diag:'/);
    assert.ok(!badPassword.output.includes(redisSecret), "Redis password leaked to diagnostic output");
  } finally {
    await close(redis);
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

  const nonexistent = await runDiagnostic(cleanEnv({
    MINIO_ENDPOINT: "http://gradix-minio-ci-probe-does-not-exist.invalid:9000",
    MINIO_ACCESS_KEY: "ci-access-key",
    MINIO_SECRET_KEY: "ci-host-test-secret",
    MINIO_BUCKET: "gradix-stg",
  }));
  assert.equal(nonexistent.code, 0, nonexistent.output);
  assert.match(nonexistent.output, /phase=s3\.connection status=FAIL cause=s3_dns_not_found_same_stack_network/);
  assert.ok(!nonexistent.output.includes("ci-host-test-secret"), "MinIO secret leaked during DNS failure");

  console.log("Diagnostics CI fault injection passed: bad Redis auth, missing CA, missing bucket, absent DNS host; no test secrets were printed.");
}

await main();

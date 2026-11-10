#!/usr/bin/env node
/** Dokaz za A4: proces koji entrypoint pokrene NEMA administratorske varijable u okruženju. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const entrypoint = fileURLToPath(new URL("./entrypoint-web.sh", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "gradix-entrypoint-"));
try {
  cpSync(entrypoint, join(dir, "entrypoint.sh"));
  mkdirSync(join(dir, "db/preflight-checks"), { recursive: true });
  mkdirSync(join(dir, "apps/web"), { recursive: true });
  writeFileSync(join(dir, "db/preflight-checks/run.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(dir, "apps/web/server.js"),
    "console.log(JSON.stringify({admin: process.env.DATABASE_ADMIN_URL ?? null, seed: process.env.SEED_PASSWORD ?? null, root: process.env.MINIO_ROOT_USER ?? null}));\n");
  const result = spawnSync("sh", ["entrypoint.sh"], {
    cwd: dir,
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://app:app@db:5432/gradix",
      AUTH_SECRET: "test-secret-with-at-least-32-characters",
      DATABASE_ADMIN_URL: "postgresql://admin:top-secret@db:5432/gradix",
      SEED_PASSWORD: "seed-top-secret",
      MINIO_ROOT_USER: "rootuser",
      RUN_MIGRATIONS: "false",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const lastLine = result.stdout.trim().split("\n").at(-1);
  assert.deepEqual(JSON.parse(lastLine), { admin: null, seed: null, root: null });
  assert.ok(!result.stdout.includes("top-secret"), "admin URL leaked to the server process output");
  console.log("Entrypoint env test passed: pokrenuti Node proces nema DATABASE_ADMIN_URL, SEED_PASSWORD ni MINIO_ROOT_*.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

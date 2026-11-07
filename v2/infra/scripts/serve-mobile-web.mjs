#!/usr/bin/env node
/**
 * Statički server za `expo export -p web` izlaz.
 *
 * Postoji iz jednog razloga: expo-sqlite na webu koristi SharedArrayBuffer, koji traži
 * COOP/COEP zaglavlja. Bez njih SQLite u pregledniku tiho ne radi i offline tok izgleda
 * "pokvareno" iako je kod ispravan. Ovo je razvojna pomoć, ne produkcijski server.
 *
 * Upotreba: node infra/scripts/serve-mobile-web.mjs [port]
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = new URL("../../apps/mobile/dist-web/", import.meta.url).pathname;
const port = Number(process.argv[2] ?? 8081);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  let path = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!path.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  if (!existsSync(path)) path = join(root, "index.html"); // SPA fallback za expo-router

  response.writeHead(200, {
    "content-type": MIME[extname(path)] ?? "application/octet-stream",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "credentialless",
    "cache-control": "no-store",
  });
  createReadStream(path).pipe(response);
}).listen(port, "0.0.0.0", () => {
  console.log(`Mobile (web) na http://0.0.0.0:${port} — izvor: ${root}`);
});

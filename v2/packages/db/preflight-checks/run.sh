#!/bin/sh
# Runtime + CI preflight. Kritične provjere SQL-a moraju koristiti DATABASE_URL (aplikacijska rola).
# DATABASE_ADMIN_URL se namjerno ne čita: administrator bi mogao sakriti RLS greške.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
database_url="${1:-${DATABASE_URL:-}}"
if [ -z "$database_url" ]; then
  echo "GREŠKA: preflight traži DATABASE_URL (aplikacijska rola), ne DATABASE_ADMIN_URL." >&2
  exit 1
fi

# psql ne razumije Prisma `?schema=public`; sačuvaj TLS parametre, ukloni samo schema.
database_url=$(printf '%s' "$database_url" | sed -E 's/[?&]schema=[^&]*//' | sed -E '/\?/!s/&/?/')

echo "→ preflight: kritične provjere baze (konekcija iz DATABASE_URL)"
if ! PGCONNECT_TIMEOUT=10 psql "$database_url" -X -v ON_ERROR_STOP=1 -q -f "$script_dir/001_security.sql"; then
  echo "GREŠKA: kritični preflight nije prošao; aplikacija se neće pokrenuti." >&2
  exit 1
fi

# Redis je opcionalan u ovoj fazi. Kad je podešen, probaj autentifikovani PING; rezultat je
# informativan i nikad ne obara deploy. Tajne i host se ne ispisuju.
if [ -n "${REDIS_HOST:-}" ]; then
  if node <<'NODE'
const net = require("node:net");
const tls = require("node:tls");
const fs = require("node:fs");
const host = process.env.REDIS_HOST;
const port = Number(process.env.REDIS_PORT || 6380);
const username = process.env.REDIS_USER || "";
const password = process.env.REDIS_PASSWORD || "";
const caPath = process.env.REDIS_TLS_CA_FILE || "";
const useTls = port === 6380 || Boolean(caPath);
const ca = caPath && fs.existsSync(caPath) ? fs.readFileSync(caPath) : undefined;
let finished = false;
let buffer = "";
let state = password ? "auth" : "ping";
let socket;
const done = (ok) => {
  if (finished) return;
  finished = true;
  if (socket) socket.destroy();
  process.exitCode = ok ? 0 : 1;
};
const encode = (parts) => `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`;
try {
  const options = { host, port, timeout: 3500, ...(ca ? { ca } : {}) };
  socket = useTls ? tls.connect(options) : net.createConnection(options);
  socket.setTimeout(3500, () => done(false));
  socket.once(useTls ? "secureConnect" : "connect", () => {
    if (useTls && socket.authorized === false) return done(false);
    if (state === "auth") socket.write(encode(username ? ["AUTH", username, password] : ["AUTH", password]));
    else socket.write(encode(["PING"]));
  });
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const end = buffer.indexOf("\r\n");
    if (end < 0) return;
    const reply = buffer.slice(0, end);
    if (reply.startsWith("-")) return done(false);
    if (state === "auth" && reply === "+OK") {
      state = "ping";
      buffer = buffer.slice(end + 2);
      socket.write(encode(["PING"]));
      return;
    }
    if (state === "ping" && reply === "+PONG") done(true);
    else done(false);
  });
  socket.once("error", () => done(false));
  socket.once("close", () => { if (!finished) done(false); });
} catch {
  done(false);
}
NODE
  then
    echo "  INFO: Redis odgovorio na PING."
  else
    echo "  INFO: Redis nije dostupan/autentifikovan; provjera je informativna, deploy se nastavlja."
  fi
else
  echo "  INFO: REDIS_HOST nije podešen; Redis provjera je preskočena."
fi

# S3/MinIO je opcionalan. HeadBucket provjerava dostupnost bucket-a bez listanja objekata.
# `gx2/` je logički prefiks ključeva (nije zaseban S3 resurs); ne radimo listing zbog ADR 0006.
if [ -n "${MINIO_ENDPOINT:-}" ] && [ -n "${MINIO_ACCESS_KEY:-}" ] && [ -n "${MINIO_SECRET_KEY:-}" ]; then
  if node --input-type=module <<'NODE'
try {
  const { S3Client, HeadBucketCommand } = await import("@aws-sdk/client-s3");
  const endpoint = process.env.MINIO_ENDPOINT;
  const bucket = process.env.MINIO_BUCKET || "gradix-v2";
  const client = new S3Client({
    endpoint,
    region: process.env.MINIO_REGION || "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY,
      secretAccessKey: process.env.MINIO_SECRET_KEY,
    },
  });
  await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(5000) });
  await client.destroy();
  console.log("  INFO: S3/MinIO bucket je dostupan; prefiks gx2/ je logički namespace.");
} catch {
  console.log("  INFO: S3/MinIO bucket nije potvrđen; provjera je informativna, deploy se nastavlja.");
  process.exitCode = 1;
}
NODE
  then
    :
  else
    : # Opcionalna provjera: namjerno ne utiče na deploy.
  fi
else
  echo "  INFO: S3/MinIO nije potpuno konfigurisan; provjera bucket-a/prefiksa je preskočena."
fi

exit 0

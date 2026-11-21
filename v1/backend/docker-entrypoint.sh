#!/bin/sh
# Gradix backend entrypoint.
#
# 1) PREFLIGHT (SSL): ako `DATABASE_URL` traži CA certifikat
#    (`sslrootcert=/putanja`), taj fajl mora postojati u kontejneru. Bez ove
#    provjere Prisma padne tek pri prvom upitu (npr. u scheduleru):
#      ENOENT: no such file or directory, open '/etc/ssl/certs/coolify-ca.crt'
#    Isključivanje: SSL_PREFLIGHT=false
# 2) MIGRACIJE: `prisma migrate deploy`. Preskače se sa RUN_MIGRATIONS=false
#    (npr. kada se pokreće više replika, a migracije idu kao poseban korak).
set -e

if [ "${SSL_PREFLIGHT:-true}" = "true" ] && [ -n "${DATABASE_URL:-}" ]; then
  ca_path=$(printf '%s' "$DATABASE_URL" | sed -n 's/.*[?&]sslrootcert=\([^&]*\).*/\1/p')
  if [ -n "$ca_path" ]; then
    if [ ! -f "$ca_path" ]; then
      echo "[gradix] GREŠKA: DATABASE_URL zahtijeva CA certifikat '$ca_path'," >&2
      echo "[gradix]   ali tog fajla nema u kontejneru (ili je direktorij)." >&2
      echo "[gradix]   docker-compose.yml mapira POSTGRES_CA_FILE → /etc/ssl/certs/coolify-ca.crt." >&2
      echo "[gradix]   Na Coolify hostu provjeri /data/coolify/ssl/coolify-ca.crt ili postavi" >&2
      echo "[gradix]   POSTGRES_CA_FILE na stvarnu putanju. Detalji: docs/INFRASTRUCTURE.md §4." >&2
      exit 1
    fi
    echo "[gradix] SSL CA za bazu: $ca_path"
  fi
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[gradix] prisma migrate deploy"
  ./node_modules/.bin/prisma migrate deploy
else
  echo "[gradix] RUN_MIGRATIONS=false — preskačem migracije"
fi

exec "$@"

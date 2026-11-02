#!/bin/sh
# Gradix backend entrypoint.
#
# Pokreće Prisma migracije prije starta aplikacije. Migracije se mogu preskočiti
# postavljanjem RUN_MIGRATIONS=false (npr. kada se pokreće više replika i
# migracije se izvršavaju kao poseban korak u CI/CD-u).
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[gradix] prisma migrate deploy"
  ./node_modules/.bin/prisma migrate deploy
else
  echo "[gradix] RUN_MIGRATIONS=false — preskačem migracije"
fi

exec "$@"

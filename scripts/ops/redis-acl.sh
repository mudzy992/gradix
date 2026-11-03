#!/usr/bin/env bash
# INF-07 — generiše ACL liniju za aplikacijski Redis korisnik (Gradix backend).
#
# Skripta **ne mijenja** Redis: samo ispiše komandu koju vlasnik infrastrukture pokrene u
# `redis-cli` (lozinku generiše i unosi vlasnik — nikad ne prolazi kroz repo ni CI).
#
#   REDIS_USER=gradix REDIS_PREFIX='gradix:' ./scripts/ops/redis-acl.sh
#
# Prava su minimalna (docs/INFRASTRUCTURE.md §8):
#   - ključevi samo `<prefix>*` (`~<prefix>*`) — throttle brojači i budući cache,
#   - komande koje backend zaista koristi: PING, MULTI/EXEC, INCR, PEXPIRE, PTTL
#     (+ GET/SET/DEL/EXISTS/TTL za cache),
#   - ništa administrativno (bez `@admin`, bez `FLUSHALL`, bez `CONFIG`, bez `KEYS`).
set -euo pipefail

USER_NAME="${REDIS_USER:-gradix}"
PREFIX="${REDIS_PREFIX:-gradix:}"
CA_FILE="${REDIS_CA_FILE:-/data/coolify/ssl/redis-core/redis-ca.crt}"
HOST="${REDIS_HOST:-redis-core}"
PORT="${REDIS_PORT:-6380}"

# `reset` čini liniju idempotentnom: ponovno pokretanje zamjenjuje sva prava, ne dodaje ih.
COMMANDS="+ping +multi +exec +incr +pexpire +pttl +get +set +del +exists +ttl"

cat <<ACL
# 1) Dodaj/obnovi korisnika (lozinku upiši umjesto <LOZINKA>; bez navodnika u lozinci):
ACL SETUSER ${USER_NAME} reset on ><LOZINKA> ~${PREFIX}* ${COMMANDS}

# 2) Provjeri da su prava tačno takva (očekivano: on, ~${PREFIX}*, bez @admin):
ACL GETUSER ${USER_NAME}

# 3) Sačuvaj ACL ako server koristi \`aclfile\` (bez ovoga se korisnik gubi pri restartu):
#    ACL SAVE

# 4) Test iz kontejnera/hosta sa CA certifikatom:
redis-cli -h ${HOST} -p ${PORT} --tls --cacert ${CA_FILE} \\
  --user ${USER_NAME} --pass '<LOZINKA>' PING
ACL

#!/bin/sh
# Pokreće bundlovani demo .mjs iz runtime slike (bez pnpm/tsx).
# Poziv: run-demo-mjs.sh <ime-bez-ext> [--need-app-url]
set -eu

name="${1:?treba ime bundla (npr. demo-sukobi)}"
need_app="${2:-}"

: "${DATABASE_ADMIN_URL:=${DATABASE_URL:-}}"
if [ -z "${DATABASE_ADMIN_URL}" ]; then
  echo "GREŠKA: potreban DATABASE_URL ili DATABASE_ADMIN_URL." >&2
  exit 1
fi
if [ "$need_app" = "--need-app-url" ] && [ -z "${DATABASE_URL:-}" ]; then
  echo "GREŠKA: potreban DATABASE_URL (aplikacijska rola)." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bundle=""
for ext in mjs cjs; do
  if [ -f "$script_dir/${name}.${ext}" ]; then
    bundle="$script_dir/${name}.${ext}"
    break
  fi
done
if [ -z "$bundle" ]; then
  echo "GREŠKA: nema ${name}.mjs/.cjs — redeployaj sliku koja uključuje demo bundlove." >&2
  exit 1
fi

# psql/pg ne razumiju ?schema=public; sslmode/sslrootcert ostaju.
strip_schema() {
  printf '%s' "$1" | sed -E 's/[?&]schema=[^&]*//' | sed -E '/\?/!s/&/?/'
}
DATABASE_ADMIN_URL=$(strip_schema "$DATABASE_ADMIN_URL")
export DATABASE_ADMIN_URL
if [ -n "${DATABASE_URL:-}" ]; then
  DATABASE_URL=$(strip_schema "$DATABASE_URL")
  export DATABASE_URL
fi

node "$bundle"

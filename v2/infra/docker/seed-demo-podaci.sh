#!/bin/sh
# Demo radnici/mašine/rokovi iz /app/demo-podaci (xlsx). Bez pnpm/tsx.
# Coolify Terminal: ./seed-demo-podaci.sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$script_dir/run-demo-mjs.sh" seed-demo-podaci --need-app-url

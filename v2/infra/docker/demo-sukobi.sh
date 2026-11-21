#!/bin/sh
# Novi demo sukobi (ADMIN). Coolify Terminal: ./demo-sukobi.sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$script_dir/run-demo-mjs.sh" demo-sukobi

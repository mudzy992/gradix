#!/bin/sh
# Demo podaci za Pregled (ADMIN). Coolify Terminal: ./demo-pregled.sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$script_dir/run-demo-mjs.sh" demo-pregled

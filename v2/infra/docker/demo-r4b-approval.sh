#!/bin/sh
# R4b sidro dani (ADMIN). Coolify Terminal: ./demo-r4b-approval.sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$script_dir/run-demo-mjs.sh" demo-r4b-approval

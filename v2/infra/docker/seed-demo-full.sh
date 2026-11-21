#!/bin/sh
# Jedna naredba za staging demo: seed naloga + podaci + sukobi + pregled + R4b sidro.
# Coolify Terminal (privremeno DATABASE_ADMIN_URL u env — ukloni nakon seeda):
#   read -s SEED_PASSWORD; export SEED_PASSWORD
#   cd /app && ./seed-demo-full.sh
#   unset SEED_PASSWORD
# Zatim ukloni DATABASE_ADMIN_URL iz Coolify env ako je bio dodan samo za seed.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$script_dir/seed.sh"
"$script_dir/seed-demo-podaci.sh"
"$script_dir/demo-sukobi.sh"
"$script_dir/demo-pregled.sh"
"$script_dir/demo-r4b-approval.sh"
echo "seed-demo-full: gotovo."

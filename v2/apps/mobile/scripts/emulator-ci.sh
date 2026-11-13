#!/usr/bin/env bash
# Ulazna tačka za korak „Maestro tokovi (emulator)" u workflowu mobilni-e2e.yml.
# Pokreće ga reactivecircus/android-emulator-runner kroz `script:` parametar.
#
# ZAŠTO ovaj fajli postoji: akcija razbija script po REDOVIMA i svaki red pokreće
# kao zaseban `sh -c` (v. script-parser.ts u repozitoriju akcije). Višeredne
# konstrukcije (if/then/fi, petlje) u workflowu zbog toga pucaju sintaksnom
# greškom. Pravilo: `script:` je uvijek TAČNO JEDAN red — poziv ove skripte — a
# sva logika živi ovdje.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"   # v2/apps/mobile/scripts
mobile="$(dirname "$here")"             # v2/apps/mobile

# announce <notice|error> <poruka>
announce() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::$1 title=Emulator::$2"
  else
    echo "Emulator: $2"
  fi
}

# Animacije gasimo — najveći izvor lažnih padova na emulatoru.
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

# Ključni korak koji je prva verzija workflowa preskočila: APK mora biti
# instaliran na emulatoru prije maestro launchApp.
if ! adb install -r "$mobile/.ci-apk/app-release.apk"; then
  announce error "instalacija APK-a na emulator pala"
  exit 1
fi
if ! adb shell pm list packages | grep -q ba.gradix.teren; then
  announce error "paket ba.gradix.teren nije nađen nakon instalacije"
  exit 1
fi
announce notice "APK instaliran na emulator"

bash "$here/maestro-ci.sh" "${SCENARIJ:-sve}" "${POKUSAJA:-3}"

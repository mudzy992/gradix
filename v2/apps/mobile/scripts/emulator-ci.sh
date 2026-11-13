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

# Dimna proba bez Maestra: aplikacija se pokreće direktno (am start) pa se čita
# šta je stvarno na ekranu. Razdvaja „aplikacija se ne otvara" (release problem)
# od „Maestro ne vidi sadržaj" (driver problem) — prije nego ijedan tok krene.
adb shell am start -n ba.gradix.teren/.MainActivity >/dev/null
sleep 8
resumed="$(adb shell dumpsys activity activities 2>/dev/null | grep -m1 -oE '(topResumedActivity|mResumedActivity)=[^ }]*' | cut -c1-120)"
announce notice "dimna proba — aktivnost u prvom planu: ${resumed:-nepoznato}"
adb shell uiautomator dump /sdcard/uidump.xml >/dev/null 2>&1 || true
tekstovi="$(adb shell cat /sdcard/uidump.xml 2>/dev/null | tr '\n' ' ' | grep -o 'text="[^"]*"' | head -6 | paste -sd '|' - | cut -c1-200)"
announce notice "dimna proba — vidljivi tekstovi: ${tekstovi:-nema teksta u hijerarhiji}"
jserr="$(adb logcat -d 2>/dev/null | grep -E 'ReactNativeJS|FATAL EXCEPTION' | tail -4 | tr '\n' ' ' | cut -c1-220)"
if [ -n "$jserr" ]; then
  announce error "dimna proba — logcat greške: $jserr"
fi
adb logcat -c >/dev/null 2>&1 || true  # čist logcat za dijagnoze po toku

bash "$here/maestro-ci.sh" "${SCENARIJ:-sve}" "${POKUSAJA:-3}"

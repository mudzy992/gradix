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

# Sistemu dati da se smiri nakon boot-a: hladan boot zna ostaviti ANR dijalog
# („Process system isn't responding") NAVRH ekrana — app ispod njega radi, ali
# ni Maestro ni dump ne vide kroz njega. Zato: odmor, baterija pokušaja
# otkazivanja, provjera da je čisto, pa tek onda dimna proba.
sleep 45
adb shell settings put global anr_show_background 0 >/dev/null 2>&1 || true
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
adb shell input keyevent 66 >/dev/null 2>&1 || true  # ENTER — potvrdi „Wait" ako dijalog stoji
adb shell input keyevent 4 >/dev/null 2>&1 || true   # BACK — zatvori eventualni ostatak
adb shell input tap 540 1500 >/dev/null 2>&1 || true # tap na „Wait" u dijalogu (sredina ekrana)
sleep 2

# Fokus prozora je istina o tome šta je stvarno na vrhu (dijalog ili app).
focus="$(adb shell dumpsys window windows 2>/dev/null | grep -E "mCurrentFocus|mFocusedWindow" | head -2 | tr '\n' ' ' || true)"
announce warning "dimna proba — fokus prozora: ${focus:-nepoznato}"

adb shell uiautomator dump /sdcard/anr-check.xml >/dev/null 2>&1 || true
anr="$(adb shell cat /sdcard/anr-check.xml 2>/dev/null | grep -c "isn't responding" || true)"
if [ "${anr:-0}" -gt 0 ]; then
  announce warning "dimna proba — ANR dijalog i dalje stoji nakon pokušaja otkazivanja"
  # ANR tragovi: koji proces i koja nit su blokirani (jedina prava istina o ANR-u).
  adb root >/dev/null 2>&1 || true
  sleep 3
  anr_files="$(adb shell 'ls -t /data/anr/ 2>/dev/null | head -2' 2>/dev/null | tr '\n' ' ' || true)"
  announce warning "dimna proba — ANR zapisi: ${anr_files:-nema ih}"
  if [ -n "${anr_files// /}" ]; then
    first_anr="$(echo "$anr_files" | awk '{print $1}')"
    subj="$(adb shell "grep -m1 'Subject' /data/anr/$first_anr 2>/dev/null" 2>/dev/null | cut -c1-200 || true)"
    announce warning "dimna proba — ANR subjekt: ${subj:-?}"
  fi
else
  announce warning "dimna proba — nema ANR dijaloga na ekranu"
fi

# Dimna proba bez Maestra: aplikacija se pokreće direktno (am start) pa se čita
# šta je stvarno na ekranu. Razdvaja „aplikacija se ne otvara" (release problem)
# od „Maestro ne vidi sadržaj" (driver problem) — prije nego ijedan tok krene.
# uiautomator dump IDE SAMO OVDJE: tokom maestro runa dump kolidira s Maestrovim
# pristupom accessibility stablu i ruši aplikaciju/Maestra (potvrđeno runom
# 43479147231: FATAL EXCEPTION u app-u + system ANR nakon dumpova po padu).
adb shell am start -n ba.gradix.teren/.MainActivity >/dev/null
sleep 8
resumed="$(adb shell dumpsys activity activities 2>/dev/null | grep -m1 -E "topResumedActivity|mResumedActivity" | cut -c1-200 || true)"
announce warning "dimna proba — aktivnost u prvom planu: ${resumed:-nepoznato}"
adb shell uiautomator dump /sdcard/uidump.xml >/dev/null 2>&1 || true
tekstovi="$(adb shell cat /sdcard/uidump.xml 2>/dev/null | tr '\n' ' ' | grep -o 'text="[^"]*"' | head -8 | paste -sd '|' - | cut -c1-200 || true)"
announce warning "dimna proba — vidljivi tekstovi (8s): ${tekstovi:-nema teksta u hijerarhiji}"
# Drugi pogled nakon još 20s: ako se app zaglavio na splashu/spinneru, ovo to
# razotkrije (prazni tekstovi i nakon 28s = bootstrap se nije završio).
sleep 20
adb shell uiautomator dump /sdcard/uidump2.xml >/dev/null 2>&1 || true
tekstovi2="$(adb shell cat /sdcard/uidump2.xml 2>/dev/null | tr '\n' ' ' | grep -o 'text="[^"]*"' | head -8 | paste -sd '|' - | cut -c1-200 || true)"
announce warning "dimna proba — vidljivi tekstovi (28s): ${tekstovi2:-nema teksta u hijerarhiji}"
jserr="$(adb logcat -d 2>/dev/null | grep "ReactNativeJS" | grep -E " E | W " | tail -6 | tr '\n' ' ' | cut -c1-220 || true)"
if [ -n "$jserr" ]; then
  announce error "dimna proba — JS greške: $jserr"
fi
# [e2e] breadcrumbs iz aplikacije (console.log → ReactNativeJS) — glavni
# signal dok se dijagnostifikuje release boot.
crumbs="$(adb logcat -d 2>/dev/null | grep "\[e2e\]" | tail -8 | tr '\n' ' ' | cut -c1-220 || true)"
announce warning "dimna proba — [e2e] breadcrumbs: ${crumbs:-nema ih}"
fatal="$(adb logcat -d 2>/dev/null | grep -A 18 "FATAL EXCEPTION" | tail -20 | tr '\n' ' ' | cut -c1-220 || true)"
if [ -n "$fatal" ]; then
  announce error "dimna proba — FATAL: $fatal"
fi
adb logcat -c >/dev/null 2>&1 || true  # čist logcat za dijagnoze po toku

bash "$here/maestro-ci.sh" "${SCENARIJ:-sve}" "${POKUSAJA:-3}"

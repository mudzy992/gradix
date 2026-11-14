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

# announce <notice|warning|error> <poruka>
announce() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::$1 title=Emulator::$2"
  else
    echo "Emulator: $2"
  fi
}

# Svaki neuspjeli red se oglašava s brojem reda i izlaznim kodom — jedini
# pouzdani način da se vidi GDJE je skripta stala (exit kodovi poput 224 iz
# vanjskih alata inače ostaju nijemi).
trap 'announce error "emulator-ci.sh stao u redu $LINENO (kod $?)"' ERR

# Pojasnjava čekanje na boot: akcija čeka boot_completed, ali pojasnjava
# dodatna provjera košta malo a spašava slučaj kad device još diže servise.
adb wait-for-device
boot=""
for i in $(seq 1 60); do
  boot="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  if [ "$boot" = "1" ]; then break; fi
  sleep 5
done
announce warning "boot_completed=$boot (nakon $((i * 5))s)"
# Kratki odmor sistema nakon boota (slika je aosp-atd — ogoljena za CI, bez
# telefonije i Google aplikacija; prijašnje slike su imale SystemUI crash-loop
# „Could not find Telephony Service" i 18 minuta zagrijavanja — run 43596904847).
sleep 30

# Animacije gasimo — najveći izvor lažnih padova na emulatoru. Sa retryjem:
# prvih trenutaka nakon boot-a adb zna odbiti komandu.
for attempt in 1 2 3; do
  if adb shell settings put global window_animation_scale 0 \
     && adb shell settings put global transition_animation_scale 0 \
     && adb shell settings put global animator_duration_scale 0; then
    break
  fi
  announce warning "gašenje animacija nije uspjelo (pokušaj $attempt) — čekam i pokušavam ponovo"
  sleep 10
done

# Ključni korak koji je prva verzija workflowa preskočila: APK mora biti instaliran
# na emulatoru prije maestro launchApp. Sa retryjem — odmah nakon boot-a adb
# install zna pasti s „Could not access the Package Manager"; ako pada i dalje,
# izlaz adb install (razlog pada) ide u anotaciju, a pokušaji koriste varijante
# flagova (-t za testOnly, -d za downgrade, te čista instalacija bez -r).
installed=0
inst_flags=("-r" "-r -t" "-r -d -t" "")
for attempt in 1 2 3 4; do
  flags="${inst_flags[$((attempt - 1))]}"
  inst_out="$(adb install $flags "$mobile/.ci-apk/app-release.apk" 2>&1 || true)"
  if adb shell pm list packages 2>/dev/null | grep -q ba.gradix.teren; then
    installed=1
    break
  fi
  announce warning "instalacija APK-a nije uspjela (pokušaj $attempt/4, flagovi '$flags'): $(echo "$inst_out" | tr '\n' ' ' | cut -c1-200)"
  adb uninstall ba.gradix.teren >/dev/null 2>&1 || true
  sleep 15
done
if [ "$installed" != "1" ]; then
  announce error "instalacija APK-a na emulator pala nakon 4 pokušaja"
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
focus="$(adb shell dumpsys window 2>/dev/null | grep -E "mCurrentFocus|mFocusedWindow" | head -2 | tr '\n' ' ' || true)"
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

# ATD slika nema pravi launcher: FallbackHome (com.android.fakesystemapp) drži
# fokus prozora i zna doći ISPRAD aplikacije (run f9059f8: mCurrentFocus=
# FallbackHome dok je naša aktivnost resumed; index se unmountuje kad launcher
# preuzme prvi plan). E2E ne treba home ekran — onemogućićemo lažni launcher i
# aplikacija će biti jedini vidljivi prozor.
if adb shell pm disable-user --user 0 com.android.fakesystemapp >/dev/null 2>&1; then
  announce warning "FallbackHome (lažni launcher ATD slike) onemogućen"
else
  announce warning "FallbackHome nije mogao biti onemogućen — pokušaj force-stop"
  adb shell am force-stop com.android.fakesystemapp >/dev/null 2>&1 || true
fi
sleep 2
focus_after="$(adb shell dumpsys window 2>/dev/null | grep -m1 "mCurrentFocus" || true)"
announce warning "fokus nakon onemogućavanja launchera: ${focus_after:-nepoznato}"

# Keyguard: na ATD slici bez SystemUI boot ostavlja ekran u zaključanom stanju
# (FallbackHome je bio placeholder upravo toga) — i pošto ga je onemogućen,
# fokus je null jer keyguard i dalje drži prozor aplikacije van vidljivosti.
# Standardno CI otključavanje: probudi ekran, odbaci keyguard, pa MENU.
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
adb shell input keyevent 82 >/dev/null 2>&1 || true
sleep 2
kg_state="$(adb shell dumpsys window 2>/dev/null | grep -iE "mDreamingLockscreen|mKeyguardShown|Keyguard" | head -3 | tr '\n' '|' | cut -c1-200 || true)"
announce warning "keyguard stanje: ${kg_state:-nepoznato}"
wake="$(adb shell dumpsys power 2>/dev/null | grep -m1 "mWakefulness" || true)"
announce warning "budnost ekrana: ${wake:-nepoznato}"
focus_unlock="$(adb shell dumpsys window 2>/dev/null | grep -m1 "mCurrentFocus" || true)"
announce warning "fokus nakon otključavanja: ${focus_unlock:-nepoznato}"
fi

# Dimna proba bez Maestra: aplikacija se pokreće direktno (am start) pa se čita
# šta je stvarno na ekranu. Razdvaja „aplikacija se ne otvara" (release problem)
# od „Maestro ne vidi sadržaj" (driver problem) — prije nego ijedan tok krene.
# uiautomator dump IDE SAMO OVDJE: tokom maestro runa dump kolidira s Maestrovim
# pristupom accessibility stablu i ruši aplikaciju/Maestra (potvrđeno runom
# 43479147231: FATAL EXCEPTION u app-u + system ANR nakon dumpova po padu).
adb shell am start -n ba.gradix.teren/.MainActivity >/dev/null
sleep 8
pids8="$(adb shell pidof ba.gradix.teren 2>/dev/null | tr '\n' ' ' || true)"
announce warning "dimna proba — pid app-a (8s): ${pids8:-PROCES NIJE ŽIV}"
resumed="$(adb shell dumpsys activity activities 2>/dev/null | grep -m1 -E "topResumedActivity|mResumedActivity" | cut -c1-200 || true)"
announce warning "dimna proba — aktivnost u prvom planu: ${resumed:-nepoznato}"
adb shell uiautomator dump /sdcard/uidump.xml >/dev/null 2>&1 || true
tekstovi="$(adb shell cat /sdcard/uidump.xml 2>/dev/null | tr '\n' ' ' | grep -o 'text="[^"]*"' | head -8 | paste -sd '|' - | cut -c1-200 || true)"
announce warning "dimna proba — vidljivi tekstovi (8s): ${tekstovi:-nema teksta u hijerarhiji}"
# Drugi pogled nakon još 20s: ako se app zaglavio na splashu/spinneru, ovo to
# razotkrije (prazni tekstovi i nakon 28s = bootstrap se nije završio).
sleep 20
pids28="$(adb shell pidof ba.gradix.teren 2>/dev/null | tr '\n' ' ' || true)"
announce warning "dimna proba — pid app-a (28s): ${pids28:-PROCES NIJE ŽIV}"
adb shell uiautomator dump /sdcard/uidump2.xml >/dev/null 2>&1 || true
tekstovi2="$(adb shell cat /sdcard/uidump2.xml 2>/dev/null | tr '\n' ' ' | grep -o 'text="[^"]*"' | head -8 | paste -sd '|' - | cut -c1-200 || true)"
announce warning "dimna proba — vidljivi tekstovi (28s): ${tekstovi2:-nema teksta u hijerarhiji}"
# Treći pogled nakon ponovnog pokretanja: ako je prvi start pao u loš prozor
# sistema, restart pokazuje stabilno stanje.
adb shell am start -n ba.gradix.teren/.MainActivity >/dev/null 2>&1 || true
sleep 15
adb shell uiautomator dump /sdcard/uidump3.xml >/dev/null 2>&1 || true
tekstovi3="$(adb shell cat /sdcard/uidump3.xml 2>/dev/null | tr '\n' ' ' | grep -o 'text="[^"]*"' | head -10 | paste -sd '|' | cut -c1-220 || true)"
announce warning "dimna proba - vidljivi tekstovi (restart+15s): ${tekstovi3:-nema teksta u hijerarhiji}"
jserr="$(adb logcat -d 2>/dev/null | grep "ReactNativeJS" | grep -E " E | W " | tail -6 | tr '\n' ' ' | cut -c1-220 || true)"
if [ -n "$jserr" ]; then
  announce error "dimna proba — JS greške: $jserr"
fi
# [e2e] breadcrumbs iz aplikacije (console.log → ReactNativeJS) — glavni
# signal dok se dijagnostifikuje release boot. POJEDINAČNO po liniji: združeni
# zapis se znao odsjeći usred ključnog breadcrumba (run d8cb7cc).
adb logcat -d 2>/dev/null | grep "\[e2e\]" | tail -14 | while IFS= read -r line; do
  announce warning "crumb: $(echo "$line" | cut -c1-200)"
done

# Render vs accessibility: view hijerarhija top aktivnosti pokazuje da li je
# ekran STVARNO nacrtan (ReactTextView/ReactImageView čvorovi) i kad uiautomator
# ne vidi nijedan tekst — tada je slomljeno izlaganje teksta, ne render.
adb shell dumpsys activity top > /tmp/top.txt 2>&1 || true
top_count="$(grep -c "TextView" /tmp/top.txt || true)"
announce warning "dimna proba — TextView čvorova u hijerarhiji top aktivnosti: ${top_count:-0} (dokaz da li je ekran nacrtan)"
fatal="$(adb logcat -d 2>/dev/null | grep -A 22 "FATAL EXCEPTION" | head -24 | tr '\n' ' ' | cut -c1-600 || true)"
if [ -n "$fatal" ]; then
  announce error "dimna proba — FATAL: $fatal"
fi
adb logcat -c >/dev/null 2>&1 || true  # čist logcat za dijagnoze po toku

bash "$here/maestro-ci.sh" "${SCENARIJ:-sve}" "${POKUSAJA:-3}"

#!/usr/bin/env bash
# Orkestrator Maestro CI tokova na emulatoru. Pokreće ga workflow
# „Mobilni E2E (Maestro)" iz koraka android-emulator-runner.
#
# Upotreba: maestro-ci.sh <scenarij> [maks_pokušaja]
#   scenarij: sve | snimci | offline | grupa
#   maks_pokušaja: zadano 3 (1 = bez retryja)
#
# Retry politika: svaki tok se pokušava do maks_pokušaja puta, s hard capom
# MAKS_TRAJANJE sekundi po pokušaju (štiti od vješto obješene sesije koja bi
# pojela budžet joba). Stanje i fokus prije svakog pokušaja priprema run_flow
# (pm clear za tokove iz prijave, force-stop za tokove koji nastavljaju stanje
# — tok 03 se retreja u avionskom režimu, pa retry ne dira mrežu). Ako tok 02
# (prijava i keš) ne prođe ni nakon retryja, offline blok se prekida — tokovi
# 03/04 ovise o njegovom stanju — ali ostali scenariji se ipak izvrše, da
# izvještaj ima sve dokaze. Izlazni kod: 0 samo ako nijedan tok nije ostao crven.
#
# Ishodi se oglašavaju i kroz GitHub anotacije (::notice/::error) — vidljive
# su u Actions sučelju i preko API-ja, i kad logovi nisu dostupni.
#
# Okruženje: DEMO_LOZINKA (obavezno), adb na PATH-u (unutar emulator-runnera).
set -uo pipefail

scenario="${1:-sve}"
max_attempts="${2:-3}"
MAKS_TRAJANJE=300  # sekundi po pokušaju toka

# announce <notice|error> <tok> <poruka>
announce() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::$1 title=Maestro — $2::$3"
  else
    echo "Maestro — $2: $3"
  fi
}


cd "$(dirname "$0")/.."  # apps/mobile

# Rezolucija maestro binarne: PATH, pa fallback na standardnu lokaciju
# instalacije (~/.maestro/bin) — GITHUB_PATH iz prethodnog koraka treba da je
# dovoljan, ali fallback košta ništa a spašava ručna pokretanja.
MAESTRO_BIN="$(command -v maestro || true)"
if [ -z "$MAESTRO_BIN" ] && [ -x "$HOME/.maestro/bin/maestro" ]; then
  MAESTRO_BIN="$HOME/.maestro/bin/maestro"
fi
if [ -z "$MAESTRO_BIN" ]; then
  echo "maestro nije nađen ni na PATH-u ni u ~/.maestro/bin" >&2
  exit 2
fi
if [ -z "${DEMO_LOZINKA:-}" ]; then
  echo "DEMO_LOZINKA mora biti postavljena u okolini" >&2
  exit 2
fi
# SAMO dužina (nikad sadržaj): dokaz da li je polje Lozinka primilo tačnu
# vrijednost (n znakova) ili dupliranje (više od n).
announce warning "lozinka" "DEMO_LOZINKA dužina: ${#DEMO_LOZINKA} znakova"

# ATD „launcher" (fakesystemapp) zna ukrasti window fokus poslije restarta
# app-a (run 43674507709: app Window #0, ali Maestro slijep jer čita samo
# fokusirani prozor). CI tokovima home ekran ne treba — ubijamo launcher
# jednom, pa pri am start-u app neminovno dobija fokus.
adb shell am force-stop com.android.fakesystemapp >/dev/null 2>&1 || true
sleep 1

# ===== PRIVREMENA DIJAGNOSTIKA UNOSA v2 (ukloniti nakon analize) =====
# Poređenje dva injekcijska puta na istom emulatoru, u istom runu:
#   A) maestro mini-flow samo fokusira Email polje (element tap) pa
#      `adb shell input text` upisuje — system `input` binary put;
#   B) maestro mini-flow radi i tap i inputText — pressKeyCode put.
# [e2e] email changed crumb u index.tsx otkriva šta je RN polje primilo.
# (uiautomator dump ne radi na ATD-u — NIJE_NAĐEN u prošlom runu; IME put
# nemoguć: "cannot be enabled for user #0", ime list prazan.)
echo "::group::Dijagnoza unosa v2 (privremeno)"
artifacts="maestro-artifacts"
mkdir -p "$artifacts/junit" 2>/dev/null || true

cat > /tmp/dijag-a.yaml <<'YAML'
appId: ba.gradix.teren
name: dijag-a-fokus
---
- tapOn:
    id: "Email"
YAML
cat > /tmp/dijag-b.yaml <<'YAML'
appId: ba.gradix.teren
name: dijag-b-maestro
---
- tapOn:
    id: "Email"
- inputText: "maestro@x.ba"
YAML

# A) fokus preko maestro element tapa, tekst preko adb input text
adb shell pm clear ba.gradix.teren >/dev/null 2>&1 || true
adb shell am start -n ba.gradix.teren/.MainActivity >/dev/null 2>&1 || true
for i in $(seq 1 20); do
  fokus="$(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus || true)"
  echo "$fokus" | grep -q "ba.gradix.teren" && break
  sleep 1
done
adb logcat -c
timeout 90 "$MAESTRO_BIN" test --format junit --output "$artifacts/junit/dijag-a.xml" /tmp/dijag-a.yaml >/dev/null 2>&1 || announce warning "dijagnoza" "mini-flow A (fokus) nije prošao čisto"
sleep 1
timeout 20 adb shell input text "radik@demo.ba" >/dev/null 2>&1 || true
sleep 3
crumb_a="$(timeout 10 adb logcat -d -s ReactNativeJS:V 2>/dev/null | grep "email changed" | tail -1 | tr -d '\r')"
announce notice "dijagnoza-A" "adb input text → RN: ${crumb_a:-NEMA CRUMBA}"

# B) i tap i inputText preko maestra (pressKeyCode put)
adb shell pm clear ba.gradix.teren >/dev/null 2>&1 || true
adb shell am start -n ba.gradix.teren/.MainActivity >/dev/null 2>&1 || true
for i in $(seq 1 20); do
  fokus="$(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus || true)"
  echo "$fokus" | grep -q "ba.gradix.teren" && break
  sleep 1
done
adb logcat -c
timeout 90 "$MAESTRO_BIN" test --format junit --output "$artifacts/junit/dijag-b.xml" /tmp/dijag-b.yaml >/dev/null 2>&1 || announce warning "dijagnoza" "mini-flow B (inputText) nije prošao čisto"
sleep 3
crumb_b="$(timeout 10 adb logcat -d -s ReactNativeJS:V 2>/dev/null | grep "email changed" | tail -1 | tr -d '\r')"
announce notice "dijagnoza-B" "maestro inputText → RN: ${crumb_b:-NEMA CRUMBA}"

echo "::endgroup::"
announce error "dijagnoza" "kraj dijagnostičkog runa — tokovi namjerno preskočeni"
exit 1
# ===== KRAJ PRIVREMENE DIJAGNOSTIKE v2 =====

flows_dir="maestro/ci"
artifacts="maestro-artifacts"
mkdir -p "$artifacts/junit" "$artifacts/test-output"


passed=()
failed=()

run_flow() {  # run_flow <ime> <fajl> [cisto|restart] — 0 = prošao (eventualno iz retryja)
  # Arhitektura po dokazanom runu 43646763583 (prijava čistim typingom):
  # - orkestrator priprema stanje i starta app: cisto = pm clear + start
  #   (tokovi iz prijave: 01/02/05), restart = force-stop + start (03/04:
  #   keš i neslani zapisi ostaju). RESTART je bitan: koordinatni tap na app
  #   ekranu „prlja" input (svaki sljedeći inputText duplira cijeli string —
  #   runovi 43657398421/43662146227/43671967067/43674507709), a restart
  #   procesa to čisti (84e6183: tap → restart → typing čist).
  # - fokus se ČEKA dumpsys anketom, BEZ tapanja (tap bi pokvario typing).
  #   Launcher je ubijen na početku skripte, pa je app jedini kandidat za
  #   fokus; koordinatni tap je samo očajnički fallback.
  # - tokovi idu ravno na element akcije (assertVisible/tapOn id/...) — bez
  #   launchApp (restart bi vratio fokus na launcher) i bez tapOn point.
  # 03/04 nemaju inputText (unos formom i defaultima), pa su na dupliranje
  # imuni; element tapovi (tapOn id) nisu pokazali uticaj na typing.
  local name="$1" flow="$2" mode="${3:-restart}" attempt start trajanje fokus tap_i i
  for attempt in $(seq 1 "$max_attempts"); do
    echo "::group::Maestro: $name (pokušaj $attempt/$max_attempts)"
    if [ "$mode" = "cisto" ]; then
      adb shell pm clear ba.gradix.teren >/dev/null 2>&1 || true
    else
      adb shell am force-stop ba.gradix.teren >/dev/null 2>&1 || true
    fi
    adb shell am start -n ba.gradix.teren/.MainActivity >/dev/null 2>&1 || true
    fokus=""
    for i in $(seq 1 20); do
      fokus="$(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus || true)"
      if echo "$fokus" | grep -q "ba.gradix.teren"; then break; fi
      sleep 1
    done
    if ! echo "$fokus" | grep -q "ba.gradix.teren"; then
      announce warning "$name" "fokus nije došao sam na app (20s): $(echo "$fokus" | tr -d '\r' | cut -c1-160) — pokušavam koordinatni tap (može pokvariti typing)"
      for tap_i in 1 2 3; do
        adb shell input tap 360 150 >/dev/null 2>&1 || true
        sleep 1
        fokus="$(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus || true)"
        if echo "$fokus" | grep -q "ba.gradix.teren"; then break; fi
      done
    fi
    if ! echo "$fokus" | grep -q "ba.gradix.teren"; then
      announce error "$name" "fokus nije preuzet — tok vjerovatno neće vidjeti ekran"
    fi
    start=$(date +%s)
    if timeout "$MAKS_TRAJANJE" "$MAESTRO_BIN" test \
        --format junit \
        --output "$artifacts/junit/$name-pokusaj$attempt.xml" \
        --test-output-dir "$artifacts/test-output" \
        --analyze \
        -e DEMO_LOZINKA="$DEMO_LOZINKA" \
        "$flow"; then
      trajanje=$(( $(date +%s) - start ))
      echo "::endgroup::"
      echo "✅ $name (pokušaj $attempt, ${trajanje}s)"
      announce notice "$name" "prošao (pokušaj $attempt/$max_attempts, trajanje ${trajanje}s)"
      return 0
    fi
    trajanje=$(( $(date +%s) - start ))
    echo "::endgroup::"
    echo "❌ $name (pokušaj $attempt, ${trajanje}s)"
    # Dijagnostika u anotaciju: prva greška iz junit XML-a (logovi/artefakti se iz
    # svih okruženja ne mogu preuzeti, anotacije uvijek dolaze kroz API).
    local junit="$artifacts/junit/$name-pokusaj$attempt.xml" prva=""
    if [ -f "$junit" ]; then
      prva=$(grep -o '<failure[^>]*message="[^"]*"' "$junit" | head -1 | sed 's/.*message="//; s/"$//' | cut -c1-220)
      if [ -z "$prva" ]; then
        prva=$(tr '\n' ' ' < "$junit" | grep -o '<failure[^>]*>[^<]*' | head -1 | sed 's/.*>//' | cut -c1-220)
      fi
    else
      prva="(junit nije ni nastao — maestro se srušio prije izvještaja)"
    fi
    announce error "$name" "pokušaj $attempt/$max_attempts pao (trajanje ${trajanje}s) — ${prva:-nema poruke}"
    # Native crash s stackom (glavni buffer, crash buffer zna biti prazan).
    local fatal
    fatal=$(adb logcat -d 2>/dev/null | grep -A 22 "FATAL EXCEPTION" | head -24 | tr '\n' ' ' | cut -c1-600)
    if [ -n "$fatal" ]; then
      announce error "$name" "FATAL: $fatal"
    fi
    # JS greške (ReactNativeJS) — jedina sigurna dijagnoza za release bundle.
    local jserr
    jserr=$(adb logcat -d 2>/dev/null | grep "ReactNativeJS" | grep -E " E | W " | tail -8 | tr '\n' ' ' | cut -c1-220)
    if [ -n "$jserr" ]; then
      announce error "$name" "logcat: $jserr"
    fi
    # [e2e] breadcrumbs — dokle je app stigao u ovom pokušaju.
    adb logcat -d 2>/dev/null | grep "\[e2e\]" | tail -4 | while IFS= read -r line; do
      announce error "$name" "crumb: $(echo "$line" | cut -c1-200)"
    done
    # Render dokaz: broj TextView čvorova u hijerarhiji top aktivnosti.
    adb shell dumpsys activity top > /tmp/top-fail.txt 2>&1 || true
    top_n="$(grep -c "TextView" /tmp/top-fail.txt || true)"
    announce error "$name" "TextView broj u hijerarhiji: ${top_n:-0}"
    # Z-order prozora u trenutku pada: šta je stvarno na vrhu ekrana.
    win_stack="$(adb shell dumpsys window windows 2>/dev/null | grep "Window #" | head -8 | tr '\n' '|' | cut -c1-400 || true)"
    announce error "$name" "prozori po dubini (vrh prvi): ${win_stack:-nepoznato}"
    # Fokus u trenutku pada — Maestro čita fokusirani prozor, pa je ovo ključna
    # dijagnoza: app na vrhu Z-ordera + fokus na launcheru = slijepi tok.
    fokus_fail="$(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus || true)"
    announce error "$name" "fokus pri padu: $(echo "$fokus_fail" | tr -d '\r' | cut -c1-200)"
    # API health s runnera u trenutku pada: je li backend uopšte živ (emulator
    # dolazi do njega preko 10.0.2.2 → 127.0.0.1:3000).
    api_health="$(curl -s -m 5 http://127.0.0.1:3000/api/ready 2>/dev/null || echo "NE ODGOVARA")"
    announce error "$name" "API /api/ready pri padu: $(echo "$api_health" | head -c 120)"
    # Prije retryja se NIŠTA ne dira: stanje i fokus priprema početak petlje
    # (pm clear / force-stop po načinu toka), a mrežu posjeduje pozivalac —
    # tok 03 se retreja U avionskom režimu, pa net on ovdje bi ga pokvario.
    sleep 2
  done
  return 1
}

# Offline scenarij: 02 ONLINE (prijava + keš) → mreža OFF → 03 unos → mreža ON →
# 04 slanje tačno jednom. Mreža se svakako vraća na „on" i pri padu, da sljedeći
# tokovi/ne ponovni pokušaji ne krenu iz mrtve mreže.
offline_block() {
  local rc=0
  if ! bash scripts/emulator-net.sh on; then
    announce error "mreža" "nije uspjelo uključivanje mreže prije offline bloka"
    failed+=("offline-prijava-i-kes (mreža se nije mogla uključiti)")
    return 1
  fi
  announce notice "mreža" "uključena prije offline bloka"
  if ! run_flow "offline-prijava-i-kes" "$flows_dir/02-offline-prijava-i-kes.yaml" cisto; then
    failed+=("offline-prijava-i-kes (blok prekinut: 03/04 ovise o prijavi i kešu)")
    return 1
  fi
  passed+=("offline-prijava-i-kes")
  if ! bash scripts/emulator-net.sh off; then
    announce error "mreža" "nije uspjelo isključivanje mreže (avionski režim)"
    failed+=("offline-unos (mreža se nije mogla isključiti)")
    rc=1
  else
    announce notice "mreža" "isključena (avionski režim) — offline unos"
    if run_flow "offline-unos" "$flows_dir/03-offline-unos.yaml" restart; then
      passed+=("offline-unos")
    else
      failed+=("offline-unos")
    fi
  fi
  bash scripts/emulator-net.sh on || true
  announce notice "mreža" "uključena nakon offline unosa"
  if run_flow "povratak-mreze" "$flows_dir/04-povratak-mreze.yaml" restart; then
    passed+=("povratak-mreze")
  else
    failed+=("povratak-mreze")
  fi
  return "$rc"
}

case "$scenario" in
  sve)
    if run_flow "snimci-i-A1e" "$flows_dir/01-snimci.yaml" cisto; then passed+=("snimci-i-A1e"); else failed+=("snimci-i-A1e"); fi
    offline_block || true
    if run_flow "sef-grupa" "$flows_dir/05-grupa.yaml" cisto; then passed+=("sef-grupa"); else failed+=("sef-grupa"); fi
    ;;
  snimci)
    if run_flow "snimci-i-A1e" "$flows_dir/01-snimci.yaml" cisto; then passed+=("snimci-i-A1e"); else failed+=("snimci-i-A1e"); fi
    ;;
  offline)
    offline_block || true
    ;;
  grupa)
    if run_flow "sef-grupa" "$flows_dir/05-grupa.yaml" cisto; then passed+=("sef-grupa"); else failed+=("sef-grupa"); fi
    ;;
  *)
    echo "nepoznat scenarij: $scenario (sve | snimci | offline | grupa)" >&2
    exit 2
    ;;
esac

# Logcat dokaz (padded dump) — koristan i pri prolazu.
adb logcat -d > "$artifacts/logcat.txt" 2>/dev/null || true

# Sažetak u GitHub Step Summary (ili stdout kad se vrti ručno).
{
  echo "### Mobilni E2E (Maestro) — scenarij: $scenario"
  echo ""
  echo "| Tok | Ishod |"
  echo "|---|---|"
  for name in ${passed[@]+"${passed[@]}"}; do echo "| $name | ✅ |"; done
  for name in ${failed[@]+"${failed[@]}"}; do echo "| $name | ❌ |"; done
  echo ""
  echo "Pokušaja po toku: $max_attempts (cap ${MAKS_TRAJANJE}s po pokušaju). Dokazi: video, screenshot po koraku, junit, logcat — artefakt \`maestro-dokazi\`."
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ "${#failed[@]}" -gt 0 ]; then
  echo "Nije prošlo: ${failed[*]}" >&2
  exit 1
fi
echo "Svi tokovi prošli."

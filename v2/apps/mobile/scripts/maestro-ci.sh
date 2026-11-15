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

# announce <notice|error> <tok> <poruka>
announce() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::$1 title=Maestro — $2::$3"
  else
    echo "Maestro — $2: $3"
  fi
}

flows_dir="maestro/ci"
artifacts="maestro-artifacts"
mkdir -p "$artifacts/junit" "$artifacts/test-output"

passed=()
failed=()

run_flow() {  # run_flow <ime> <fajl> — 0 = prošao (eventualno iz retryja)
  # Stanje i fokus posjeduju SAMO TOKOVI (launchApp + koordinatni tap na početku):
  # app MORA biti startan od Maestrovog drajvera (startActivity iz instrumentacije)
  # — app startan adb `am start`-om prima a11y akcije (SET_TEXT) ali koordinatni
  # tapovi ne okidaju onPress (run 43654551089: typing radi, „Prijavi se" mrtvo).
  # Fokus: am start/restart zna ostaviti fokus na launcheru iako je app Window #0,
  # a Maestro čita samo fokusirani prozor — zato je druga komanda svakog toka
  # koordinatni tap (ide u TOP prozor i preuzima fokus).
  local name="$1" flow="$2" attempt start trajanje
  for attempt in $(seq 1 "$max_attempts"); do
    echo "::group::Maestro: $name (pokušaj $attempt/$max_attempts)"
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
  if ! run_flow "offline-prijava-i-kes" "$flows_dir/02-offline-prijava-i-kes.yaml"; then
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
    if run_flow "offline-unos" "$flows_dir/03-offline-unos.yaml"; then
      passed+=("offline-unos")
    else
      failed+=("offline-unos")
    fi
  fi
  bash scripts/emulator-net.sh on || true
  announce notice "mreža" "uključena nakon offline unosa"
  if run_flow "povratak-mreze" "$flows_dir/04-povratak-mreze.yaml"; then
    passed+=("povratak-mreze")
  else
    failed+=("povratak-mreze")
  fi
  return "$rc"
}

case "$scenario" in
  sve)
    if run_flow "snimci-i-A1e" "$flows_dir/01-snimci.yaml"; then passed+=("snimci-i-A1e"); else failed+=("snimci-i-A1e"); fi
    offline_block || true
    if run_flow "sef-grupa" "$flows_dir/05-grupa.yaml"; then passed+=("sef-grupa"); else failed+=("sef-grupa"); fi
    ;;
  snimci)
    if run_flow "snimci-i-A1e" "$flows_dir/01-snimci.yaml"; then passed+=("snimci-i-A1e"); else failed+=("snimci-i-A1e"); fi
    ;;
  offline)
    offline_block || true
    ;;
  grupa)
    if run_flow "sef-grupa" "$flows_dir/05-grupa.yaml"; then passed+=("sef-grupa"); else failed+=("sef-grupa"); fi
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

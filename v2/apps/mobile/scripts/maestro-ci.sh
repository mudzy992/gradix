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



flows_dir="maestro/ci"
artifacts="maestro-artifacts"
mkdir -p "$artifacts/junit" "$artifacts/test-output"


passed=()
failed=()

adb_login() {  # adb_login <email> — priprema prijave bez Maestro inputText
  # Maestro inputText na sporom emulatoru je nondeterministički nestabilan
  # (trka s RN re-renderom: cijeli string točno ×2, ili gubitak znakova —
  # runovi 43662146227/43674507709/43705800372), a IME (atomic commitText)
  # na aosp_atd slici ne postoji ("cannot be enabled"). `adb shell input text`
  # je dokazano egzaktno (43708006955: email i lozinka tačni, prijava prošla).
  # Fokus polja preuzimaju mini-flowovi (element tap), sadržaj ide adb-om,
  # submit ostaje u glavnom toku („Prijavi se" + asercije — dokaz u junitu).
  # Fokus-tap je također trka (43717587090: 3/3 unosa nije stiglo; 43713853972:
  # 3/3 tačno) — unos je SELF-HEALING: [e2e] email/lozinka changed crumb u RN
  # otkriva šta je polje primilo; ako nije tačno, polje se isprazni (DEL) i
  # unos se ponavlja do 3 puta.
  local email="$1" out probe try
  email="${email// /%s}"
  local pass="${DEMO_LOZINKA// /%s}"
  # brisanje polja: petlja na uređaju (jedan adb poziv), 40× KEYCODE_DEL
  local ocisti='i=0; while [ $i -lt 40 ]; do input keyevent 67; i=$((i+1)); done' 
  for try in 1 2 3; do
    out="$(timeout 90 "$MAESTRO_BIN" test --format junit --output "$artifacts/junit/_fokus-email-$try.xml" "$flows_dir/_fokus-email.yaml" 2>&1 | tail -2 | tr '\n' '|' | tr -d '\r')"
    case "$out" in *Passed*) ;; *) announce warning "login priprema" "pokušaj $try — fokus Email mini-flow: ${out:-PRAZNO}" ;; esac
    sleep 1
    timeout 20 adb shell input text "$email" >/dev/null 2>&1 || true
    # RN mora progutati onChangeText (controlled polje) prije provjere:
    sleep 3
    probe="$(timeout 10 adb logcat -d -s ReactNativeJS:V 2>/dev/null | grep "email changed" | tail -1 | tr -d '\r')"
    # announce SAMO na neuspjeh (GitHub cap ~10 anotacija po tipu — uspješni
    # probe-ovi bi potrošili budžet i sakrili poruke o padovima)
    case "$probe" in *"email changed=\"$email\""*|*"email changed=\"${email//%s/ }\""*) break ;; esac
    announce warning "login priprema" "pokušaj $try — email nije stigao: ${probe:-NEMA email changed loga}"
    # nije stigao (ili djelimično) — isprazni polje i probaj ponovo
    timeout 30 adb shell "$ocisti" >/dev/null 2>&1 || true
    sleep 1
  done
  for try in 1 2 3; do
    out="$(timeout 90 "$MAESTRO_BIN" test --format junit --output "$artifacts/junit/_fokus-lozinka-$try.xml" "$flows_dir/_fokus-lozinka.yaml" 2>&1 | tail -2 | tr '\n' '|' | tr -d '\r')"
    case "$out" in *Passed*) ;; *) announce warning "login priprema" "pokušaj $try — fokus Lozinka mini-flow: ${out:-PRAZNO}" ;; esac
    sleep 1
    timeout 20 adb shell input text "$pass" >/dev/null 2>&1 || true
    sleep 3
    probe="$(timeout 10 adb logcat -d -s ReactNativeJS:V 2>/dev/null | grep "lozinka changed" | tail -1 | tr -d '\r')"
    case "$probe" in *"lozinka changed=${#DEMO_LOZINKA}zn"*) break ;; esac
    announce warning "login priprema" "pokušaj $try — lozinka nije tačna: ${probe:-NEMA lozinka changed loga}"
    timeout 30 adb shell "$ocisti" >/dev/null 2>&1 || true
    sleep 1
  done
  sleep 1
}

run_flow() {  # run_flow <ime> <fajl> <email|-> — 0 = prošao (eventualno iz retryja)
  # Arhitektura (dokazano runom 43708006955 — prijava prošla egzaktnim unosom):
  # - orkestrator u potpunosti posjeduje lifecycle: <email> = pm clear + start
  #   + adb_login priprema prijave (tokovi 01/02/05); „-" = force-stop + start
  #   (03/04 nastavljaju stanje: keš i neslani zapisi ostaju).
  # - fokus se čeka dumpsys anketom; ATD launcher je ubijen na početku skripte,
  #   pa je app jedini kandidat. ANR dijalog system procesa zna ukrasti fokus
  #   (43691349218) — otpušta se BACK-om. Koordinatni tap je zadnja odbrana.
  # - tokovi NE RADE launchApp (restart bi fokus vratio launcheru, a i
  #   startActivity razbija input fokus) i NE KORISTE inputText — Maestrov
  #   key-event unos na sporom emulatoru je nondeterministički nestabilan
  #   (duplira cijeli string: 43657398421; gubi znakove: 43705800372).
  #   Unos ide adb putem (adb_login), tokovi počinju element akcijama.
  # - element tapovi (tapOn id/text) rade pouzdano u svim runovima.
  local name="$1" flow="$2" who="${3:--}" attempt start trajanje fokus i tap_i
  for attempt in $(seq 1 "$max_attempts"); do
    echo "::group::Maestro: $name (pokušaj $attempt/$max_attempts)"
    if [ "$who" != "-" ]; then
      adb shell pm clear ba.gradix.teren >/dev/null 2>&1 || true
    else
      adb shell am force-stop ba.gradix.teren >/dev/null 2>&1 || true
    fi
    adb shell am start -n ba.gradix.teren/.MainActivity >/dev/null 2>&1 || true
    fokus=""
    for i in $(seq 1 20); do
      fokus="$(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus || true)"
      if echo "$fokus" | grep -q "Application Not Responding"; then
        announce warning "$name" "ANR dijalog u fokusu — otpuštam BACK-om"
        adb shell input keyevent 4 >/dev/null 2>&1 || true
      fi
      if echo "$fokus" | grep -q "ba.gradix.teren"; then break; fi
      sleep 1
    done
    if ! echo "$fokus" | grep -q "ba.gradix.teren"; then
      announce warning "$name" "fokus nije došao sam na app (20s): $(echo "$fokus" | tr -d '\r' | cut -c1-160) — pokušavam koordinatni tap"
      for tap_i in 1 2 3; do
        adb shell input tap 360 150 >/dev/null 2>&1 || true
        sleep 1
        fokus="$(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus || true)"
        if echo "$fokus" | grep -q "ba.gradix.teren"; then break; fi
      done
    fi
    if [ "$who" != "-" ]; then
      # RN mount mora završiti prije fokusiranja polja (v5: sleep 5 = radilo;
      # bez njega run 43710204835: polja prazna pri submitu)
      sleep 5
      adb_login "$who"
    fi
    if ! echo "$fokus" | grep -q "ba.gradix.teren"; then
      announce error "$name" "fokus nije preuzet — tok vjerovatno neće vidjeti ekran"
    fi
    start=$(date +%s)
    # stdout/stderr u fajl (logovi se iz svih okruženja ne mogu preuzeti —
    # na padu završetak ide u anotaciju). tee uz pipefail čuva exit kod.
    # NEMA --analyze: flag zove Maestro Cloud (CloudInteractor.analyze) i zna
    # srušiti CLI NAKON uspješno završenog toka (43721446496: junit failures=0,
    # a exit ≠ 0 → lažni fail + uzaludni retry). Dokazi idu kroz junit +
    # --test-output-dir (video, screenshotovi, hijerarhije, logcat).
    if timeout "$MAKS_TRAJANJE" "$MAESTRO_BIN" test \
        --format junit \
        --output "$artifacts/junit/$name-pokusaj$attempt.xml" \
        --test-output-dir "$artifacts/test-output" \
        -e DEMO_LOZINKA="$DEMO_LOZINKA" \
        "$flow" 2>&1 | tee "/tmp/maestro-$name-pokusaj$attempt.txt"; then
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
      if [ -z "$prva" ]; then
        prva="junit bez poruke; snippet: $(head -c 300 "$junit" | tr '\n' ' ' | cut -c1-280)"
      fi
    else
      prva="(junit nije ni nastao — maestro se srušio prije izvještaja)"
    fi
    announce error "$name" "pokušaj $attempt/$max_attempts pao (trajanje ${trajanje}s) — ${prva:-nema poruke}"
    # Završetak maestro izlaza (njegova poruka o padu — junit zna ostati prazan)
    # + rep system-out iz junita (posljednji izvršeni koraci — dokle je tok stigao):
    if [ -f "/tmp/maestro-$name-pokusaj$attempt.txt" ]; then
      maestro_tail="$(tail -10 "/tmp/maestro-$name-pokusaj$attempt.txt" | tr '\n' '|' | tr -d '\r' | cut -c1-400)"
      announce error "$name" "maestro rep: ${maestro_tail:-PRAZNO}"
    fi
    local junit_so=""
    if [ -f "$junit" ]; then
      junit_so="$(grep -o '<system-out>.*' "$junit" | tail -c 400 | tr '\n' '|' | tr -d '\r' | cut -c1-380)"
    fi
    # SPOJENA dijagnoza (GitHub cap ~10 anotacija po tipu — svaka mora nositi više):
    local crumbs fokus_fail api_health email_probe top_n
    crumbs="$(adb logcat -d 2>/dev/null | grep "\[e2e\]" | tail -2 | sed 's/^.*\[e2e\] //' | tr '\n' '|' | tr -d '\r' | cut -c1-260)"
    fokus_fail="$(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r' | cut -c1-120)"
    api_health="$(curl -s -m 5 http://127.0.0.1:3000/api/ready 2>/dev/null || echo "NE ODGOVARA")"
    email_probe="$(adb logcat -d -s ReactNativeJS:V 2>/dev/null | grep "email changed" | tail -1 | sed 's/^.*\[e2e\] //' | tr -d '\r' | cut -c1-80)"
    announce error "$name" "dijagnoza: crumb: ${crumbs:-—} | email: ${email_probe:——} | fokus: ${fokus_fail:-?} | API: $(echo "$api_health" | head -c 60) | junit-out: ${junit_so:-—}"
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
  if ! run_flow "offline-prijava-i-kes" "$flows_dir/02-offline-prijava-i-kes.yaml" radnik@demo.ba; then
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
    if run_flow "offline-unos" "$flows_dir/03-offline-unos.yaml" -; then
      passed+=("offline-unos")
    else
      failed+=("offline-unos")
    fi
  fi
  bash scripts/emulator-net.sh on || true
  announce notice "mreža" "uključena nakon offline unosa"
  if run_flow "povratak-mreze" "$flows_dir/04-povratak-mreze.yaml" -; then
    passed+=("povratak-mreze")
  else
    failed+=("povratak-mreze")
  fi
  return "$rc"
}

case "$scenario" in
  sve)
    if run_flow "snimci-i-A1e" "$flows_dir/01-snimci.yaml" radnik@demo.ba; then passed+=("snimci-i-A1e"); else failed+=("snimci-i-A1e"); fi
    offline_block || true
    if run_flow "sef-grupa" "$flows_dir/05-grupa.yaml" sef@demo.ba; then passed+=("sef-grupa"); else failed+=("sef-grupa"); fi
    ;;
  snimci)
    if run_flow "snimci-i-A1e" "$flows_dir/01-snimci.yaml" radnik@demo.ba; then passed+=("snimci-i-A1e"); else failed+=("snimci-i-A1e"); fi
    ;;
  offline)
    offline_block || true
    ;;
  grupa)
    if run_flow "sef-grupa" "$flows_dir/05-grupa.yaml" sef@demo.ba; then passed+=("sef-grupa"); else failed+=("sef-grupa"); fi
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

# Sažetak i kao anotacija — jedina poruka koja MORA stići kroz cap.
if [ "${#failed[@]}" -gt 0 ]; then
  announce error "sažetak" "scenarij '$scenario': PALI → ${failed[*]} | prošli → ${passed[*]:-nijedan}"
  echo "Nije prošlo: ${failed[*]}" >&2
  exit 1
fi
announce notice "sažetak" "scenarij '$scenario': svi tokovi prošli → ${passed[*]}"
echo "Svi tokovi prošli."

#!/usr/bin/env bash
# Mreža Android emulatora za Maestro CI tokove. Upotreba: emulator-net.sh on|off
#
# „Avionski režim" na emulatoru radi kroz adb (nema ručnog tipkanja): gasi se
# preko cmd connectivity + svc (pojas i naredbom — različite slike različito
# tretiraju radio interfejse). Uspjeh se NE pretpostavlja nego PROVJERAVA:
# ping 10.0.2.2 je loopback hosta — tamo CI API sluša; ako ping prođe, aplikacija
# na emulatoru vidi server, i obrnuto.
set -euo pipefail

mode="${1:-}"
if [ "$mode" != "on" ] && [ "$mode" != "off" ]; then
  echo "upotreba: $0 on|off" >&2
  exit 2
fi

toggle() {
  if [ "$mode" = "off" ]; then
    adb shell cmd connectivity airplane-mode enable >/dev/null 2>&1 || true
    adb shell svc wifi disable >/dev/null 2>&1 || true
    adb shell svc data disable >/dev/null 2>&1 || true
  else
    adb shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true
    adb shell svc wifi enable >/dev/null 2>&1 || true
    adb shell svc data enable >/dev/null 2>&1 || true
  fi
}

# 0 = host nedostupan s emulatora, 1 = dostupan.
host_reachable() {
  adb exec-out ping -c 1 -W 2 10.0.2.2 2>/dev/null | grep -q "0% packet loss"
}

for attempt in 1 2 3; do
  toggle
  sleep 3
  if [ "$mode" = "on" ] && host_reachable; then
    echo "mreža: UKLJUČENA (pokušaj $attempt)"
    exit 0
  fi
  if [ "$mode" = "off" ] && ! host_reachable; then
    echo "mreža: ISKLJUČENA (pokušaj $attempt)"
    exit 0
  fi
done

echo "mreža nije postigla stanje '$mode' ni nakon 3 pokušaja" >&2
exit 1

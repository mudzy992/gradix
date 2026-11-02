# Changelog — gps

## 2026-08-17 (Faza 11 kod)

- **Šta:** GpsDevice 1/mašina; ingest `X-Device-Key`; `lastGpsSource`; throttle 1/5s; key nije u GET.
- **Zašto:** Owner: izvrši Fazu 11.

## 2026-08-15 (presence/reset)

- **Šta:** Presence endpoint ≤30 min u geofence.
- **Zašto:** Drugi sloj freeze prijedloga.

## 2026-08-15 (peglanje)

- **Šta:** Default geofence 200 m.
- **Zašto:** Peglanje freeze-a.

## 2026-08-15 (freeze)

- **Šta:** 1 GpsDevice po mašini.
- **Zašto:** Planning freeze.

## 2026-08-15

- **Šta:** Geofence eksplicitno nije dokaz za payroll.
- **Zašto:** Klijent šalje koordinate.

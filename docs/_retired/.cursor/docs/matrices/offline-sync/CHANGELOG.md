# Changelog — offline-sync

## 2026-08-16 (Faza 6 kod)

- **Šta:** `POST /api/sync/push|pull`, `GET /api/sync/catalog`, expo-sqlite queue. Izvor: `backend/src/modules/ops/sync*.ts` + `mobile/sync/`.
- **Zašto:** Faza 6 implementacija.

## 2026-08-15 (presence/reset)

- **Šta:** Katalog TTL 24h; server reject DECOMMISSIONED/ON_HOLD.
- **Zašto:** Offline cache ne smije progurati ugašeni kamion.

## 2026-08-15 (freeze)

- **Šta:** HSE van queue-a.
- **Zašto:** Planning freeze.

## 2026-08-14

- **Šta:** Unique uključuje companyId.
- **Zašto:** Tenant izolacija sync-a.

# Settings — matrica (stub)

Status: **locked** (Faza 1). Registry u kodu + DB override. Faza 1.3.

## Scope

- PUBLIC: `GET /api/settings/public?slug=` bez auth (Faza 8; do tada public keys i uz auth)
- PRIVATE: auth + `settings.read`
- SECRET: auth + `settings.write`; GET vraća masked

## UI (Faza 3)

- boolean → Switch; number → number input; string → text; svaki key **opis**
- `/settings` samo `settings.write` (nema read-only ekrana)
- Firma (Company model): `PATCH /api/company` — vidi [auth](../auth/MATRIX.md)
- Secret: GET masked; prazan PUT ne briše

Settings su **per Company** (`@@unique([companyId, key])`). PLATFORM_ADMIN edituje izabranu firmu.

## Početni ključevi

- `app.currency` string PUBLIC default `BAM`
- `app.timezone` string PUBLIC default `Europe/Sarajevo`
- `app.dateFormat` string PUBLIC default `dd.MM.yyyy`
- `features.email` boolean PRIVATE default false
- `features.push` boolean PRIVATE default false
- `privacy.gpsNotice` string PRIVATE
- `public.companyName` `public.tagline` `public.contact` string PUBLIC (Faza 8, smiju postojati prazni)
- `timer.maxOpenHours` number PRIVATE default `12` (min 1 max 24) — Faza 2
- `geofence.defaultRadiusM` number PRIVATE default `200` — Faza 2

Secret ključevi (SMTP/FCM) dodati tek kad flag uđe u Fazu 7; do tada env only.

Paginacija 20/100 **nije** settings key (API ugovor, [PLAN_FREEZE](../../../plans/gradix-core/PLAN_FREEZE.md)).

Faza 10: `erp.allowNegativeStock` boolean PRIVATE default false.

## Realtime

PUT → Socket `settings:updated` { key }

## Izvori u kodu

- (Faza 1) `backend/src/modules/settings/`

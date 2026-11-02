> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Changelog — settings

## 2026-08-17 (Faza 10 kod)

- **Šta:** Registry `erp.allowNegativeStock` boolean PRIVATE default false.
- **Zašto:** Faza 10 izvršena.

## 2026-08-16 (Faza 3 kod)

- **Šta:** Registry `geofence.defaultRadiusM` min 10 / max 5000 (već u freeze + constants).
- **Zašto:** Settings UI šalje number; coerce treba iste granice.

## 2026-08-15 (Faza 3 lock)

- **Šta:** UI locked; firma preko PATCH /company; secret prazan PUT ne briše.
- **Zašto:** Review Faze 3.

## 2026-08-15 (Faza 1 lock)

- **Šta:** Status locked (ključevi Faze 2/10 ostaju u registryju od dana 1).
- **Zašto:** Review Faze 1.

## 2026-08-15 (peglanje)

- **Šta:** `timer.maxOpenHours`, `geofence.defaultRadiusM`.
- **Zašto:** Peglanje freeze-a.

## 2026-08-15 (freeze)

- **Šta:** Paginacija nije setting; `erp.allowNegativeStock` Faza 10.
- **Zašto:** Planning freeze.

## 2026-08-15

- **Šta:** Uklonjen `features.sms`.
- **Zašto:** SMS van proizvoda.

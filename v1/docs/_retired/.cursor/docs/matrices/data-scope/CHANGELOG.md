> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Changelog — data-scope

## 2026-08-15 (Faza 2 lock)

- **Šta:** GET /timer?projectId= SS/PM/ADMIN; PENDING start 409.
- **Zašto:** Rupe Faze 2 (drugi sloj).

## 2026-08-15 (presence/reset)

- **Šta:** Presence widget scoped.
- **Zašto:** Drugi sloj freeze prijedloga.

## 2026-08-15 (peglanje)

- **Šta:** Scope količina = projekat.
- **Zašto:** Peglanje freeze-a.

## 2026-08-15 (freeze)

- **Šta:** PLATFORM_ADMIN bez headera 403 `TENANT_HEADER_REQUIRED`.
- **Zašto:** Planning freeze.

## 2026-08-15

- **Šta:** X-Company-Id 400 za non-platform; picker za DRIVER; dashboard KPI po roli; fuel projectId; amendment; hourlyRate scope.
- **Zašto:** IDOR i curenje budžeta na worker dashboardu.

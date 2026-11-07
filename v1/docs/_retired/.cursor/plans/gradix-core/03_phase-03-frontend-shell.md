> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Faza 3 — Frontend shell (**LOCKED** 2026-08-15)

**Cilj:** Vite SPA: login, layout, settings, users, bell, Socket.IO. Nema projects/tasks/timer UI.

**Status plana:** zaključano. Izmjena = PLAN_FREEZE + ova faza + matrica. Kod tek na „izvrši Fazu 3“ (poslije Faze 1). Faza 2 nije preduslov.

**Matrice:** `auth`, `settings`, `screens`, `notifications`, `rbac`, `upload`

## Backend ugovor (uz Fazu 1)

Faza 1 lock se **dopunjuje** (nije novi modul):

- `GET /api/me` → `company: { id, name, slug }` (null za PLATFORM_ADMIN dok nema headera)
- `PATCH /api/company` — vlastita firma, `settings.write`: name, legalName, address, city, country, taxId, phone, email, logoPath. **Ne** slug, **ne** isActive. PLATFORM_ADMIN i dalje `PATCH /api/companies/:id`

## Scaffold

- `frontend/`: Vite, React, TS strict, Tailwind, React Router, TanStack Query, Zustand (auth only), RHF + zod
- shadcn: Button, Input, Label, Card, Table, Sheet, Dialog, AlertDialog, Tabs, Badge, Switch, Select, Checkbox, Dropdown, ScrollArea, Separator, Sonner, Avatar
- i18n `i18next`, default **bs** + en; svaki string; `error.code` → `errors.<CODE>`; nepoznat → `error.message`
- CSS vars: primary `#1B365D`, background `#F4F1EA`, text `#1A1A1A`, accent `#C45C26`, success `#2F6F4E`, danger `#B42318`
- **Samo light** (nema dark na webu u v1)
- Dev: Vite proxy `/api` + `/socket.io`. `VITE_API_URL` prazan = same-origin. Access: `Authorization: Bearer`
- Fajlovi kebab-case; `@/` alias

## Tokeni + auth

- Access **samo memorija** (Zustand). Refresh: sessionStorage; remember-me → localStorage. Nikad access u storage.
- 401 → jedan `POST /auth/refresh`; fail ili `AUTH_REFRESH_REUSE` → `/login`, očisti storage
- `logout-all` / reuse: `storage` event ključ `gradix:logout` → ostali tabovi van
- Login: email **ili** telefon + lozinka. Ista poruka za nepoznat i lošu lozinku
- `/forgot`: email, uvijek success copy (nema enumeracije). `/reset?token=`: stub (SMTP Faza 7)
- `change-password` (min 10) revoke-a sve → redirect `/login` + toast (ponovni login)
- `mustChangePassword`: fullscreen; samo forma + logout; nema nava. Poslije uspjeha → `/login`

## Rute

| Path | Ko |
|---|---|
| `/login` `/forgot` `/reset` | javno |
| `/` | → `/login` do Faze 8 |
| `/dashboard` | auth; placeholder **bez** KPI/presence |
| `/settings` | `settings.write` |
| `/users` | `users.write` |
| `/companies` | `platform.companies` |

Nepoznata / buduća ruta (`/projects`, …) → `/dashboard` ako auth, inače `/login`. Nema praznih stub stranica.

Nav Faze 3: Dashboard (svi) + Settings + Users + Companies po permisiji + bell. WORKER: dashboard + user menu (ime, locale, change-password, logout, logout-all). 403 na rutu → dashboard + toast `FORBIDDEN`.

Sidebar desktop; **Sheet** `< md`. 404-ekvivalent = redirect gore.

## PLATFORM_ADMIN

Switcher `GET /companies`. Izbor → `X-Company-Id` u sessionStorage + header na svaki tenant request. Bez izbora: tenant rute disabled. Promjena firme → `queryClient.invalidateQueries`.

## Settings `/settings`

- Registry: boolean Switch, number, string; svaki key **opis**
- `timer.maxOpenHours` 1–24; `geofence.defaultRadiusM` 10–5000
- Secret: GET masked, write-only (prazan submit = ne diraj)
- Firma: `PATCH /api/company` (polja gore). Logo: `POST /files` (jpeg/png/webp) → `logoPath`. taxId **nije** na public sajtu
- `settings:updated` → invalidate. Save bez full reload

## Users `/users`

- Lista: `q`, filter role, page, limit 20, sort `createdAt desc`; badge svih uloga
- Sheet create/edit: firstName+lastName obavezno, email, phone E.164 hint, employeeCode, roles multi-select
- Role opcije: ADMIN ne nudi `SUPER_ADMIN` / `PLATFORM_ADMIN`. Nema praznog roles
- `hourlyRate` polje **samo** ako caller ima `payroll.write`
- Create / reset-password: temp lozinka **jednom** (copy + upozorenje). Reset zabranjen self (UI hide)
- Deaktivacija: AlertDialog; ne self; email ostaje zauzet

## Companies `/companies`

Create: name, slug `[a-z0-9-]{3,40}`, first SUPER_ADMIN (ime, email) → temp lozinka jednom. Edit: slug **disabled**. Deaktivacija firme = platform.

## Bell + socket

- Handshake JWT (isti access). Reconnect nakon refresh s novim tokenom. Klijent ne `join` room
- `notification:new` → unread badge (`GET /notifications?unread=true` `meta.total`) + toast
- Sheet: lista, mark one, mark all. Klik = mark read; **nema deep linka** do Faze 5
- Nepoznat `type` ignorisati

## i18n / TZ

Toggle bs|en = i18n + `PATCH /me` locale. Datumi: `app.timezone` + `app.dateFormat` iz `GET /settings/public?slug=` (slug s `/me.company`). 429 → `error.message`.

## Error codes (UI)

Katalog Faze 1 + `TENANT_SLUG_IMMUTABLE` `AUTH_PASSWORD_CHANGE_REQUIRED` `AUTH_COMPANY_INACTIVE`. Nepoznat → `message`.

## Acceptance

- Login email/telefon; remember-me preživi restart preglednika; bez remember-me nestane sa zatvaranjem taba
- Access 15 min: silent refresh, user ostaje; reuse refresh → svi tabovi `/login`
- logout ≠ logout-all (drugi tab van)
- change-password → `/login`; stari refresh 401
- mustChangePassword: nema nava; WORKER ne vidi Users/Settings; WORKER+ADMIN vidi oboje
- Create user: temp jednom, drugi GET je nema; reset isto; self-reset hide
- hourlyRate polje nema za caller bez `payroll.write`
- ADMIN `PATCH /company` 200; slug disabled; WORKER `/settings` → dashboard + FORBIDDEN
- PLATFORM_ADMIN bez firme: settings disabled; sa headerom vidi izabranu
- BS default; EN persist na `/me`; error banner iz `code`
- Bell toast + badge; klik ne vodi na `/projects`
- Sheet nav `< md`; `/projects` URL → `/dashboard`
- Proxy: login radi bez CORS ručnog origin-a u devu

## Van scope

KPI dashboard, projects/tasks/timer UI, mape, Gantt, dark theme, Playwright, FCM token UI, deep link notifikacija

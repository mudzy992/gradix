# FRONTEND.md — Gradix web panel i javni sajt

> **Izvor istine za web sloj.** Sve tvrdnje provjerene u `frontend/` na commitu `e531ca2`.
> Dizajn smjer (nova paleta, admin dashboard) je odluka **D-008** — konkretan predlog ide
> vlasniku na odobrenje **prije** implementacije.

**Stack:** React 19, Vite 8, TypeScript 6, Tailwind CSS 4, Radix UI + CVA, TanStack Query,
Zustand, react-router 7, react-hook-form + zod, i18next (bs/en), Leaflet (mape), Sonner (toast).
**Lint:** `oxlint` (`.oxlintrc.json`). **Testovi:** Playwright (1 spec danas).
**Obim:** 115 fajlova u `src/`, ~8.600 LOC, **24** stranice.

---

## 1. Struktura

```
frontend/src/
  main.tsx / App.tsx        — ulaz, router provider
  routes/app-router.tsx     — sve rute (jedno mjesto)
  routes/guards.tsx         — RequireAuth, RequirePermission, RequireAnyPermission,
                              RequirePayroll, PublicOnly, CatchAllRedirect
  pages/                    — 24 stranice (jedan fajl = jedna stranica)
  components/               — layout (app-shell, sidebar-nav, bell, company-switcher, user-menu)
                              + domenske komponente (project-tabs, planned-gantt, quantity-tab,
                              erp-*, registry-fields, dispatch-sheet, diary-conflict-sheet…)
  hooks/                    — use-auth-bootstrap, use-me, use-socket, use-public-settings,
                              use-tenant-ready, use-logout-sync
  stores/                   — auth-store, company-store (Zustand)
  lib/                      — api klijent, query ključevi, helperi, formatiranje
  i18n/                     — bs (default) + en, namespace po domenu (ops, polish, payroll, erp)
  index.css                 — Tailwind + design tokeni (@theme inline)
  assets/
```

**Principi:**
- Jedan fajl = jedna stranica/komponenta; fajlovi 100–150 linija, preko 200 se dijeli.
- Rute su **deklarisane na jednom mjestu** (`app-router.tsx`) — bez „skrivenih“ ruta.
- Pristup ruti se izražava guard komponentom, ne `if`-om u stranici.

---

## 2. Routing (mapa)

| Putanja | Stranica | Pristup |
|---|---|---|
| `/` | redirect → `/login` | javno |
| `/login`, `/forgot`, `/reset` | auth stranice | `PublicOnly` |
| `/p/:slug` | javni one-page firme | javno |
| `/dashboard` | KPI po roli | `RequireAuth` |
| `/projects`, `/projects/:id` | projekti + detalj (tabovi: zadaci, količine, dnevnik, dokumenti, Gantt) | `RequireAnyPermission` |
| `/tasks`, `/tasks/:id` | zadaci + detalj | permisije zadataka |
| `/fleet`, `/fleet/map` | mašine + mapa | permisije flote |
| `/logistics` | ture + gorivo | ops permisije |
| `/diary`, `/hse` | dnevnik, HSE | SS/ADMIN |
| `/documents`, `/tenders`, `/services`, `/reports` | ured | `polish.*` |
| `/payroll` | obračun | `RequirePayroll` |
| `/erp` | partneri/troškovi/lager | `erp.*` |
| `/settings`, `/users`, `/companies` | administracija | `settings.write` / `users.*` / platform |
| `/change-password` | obavezna promjena | fullscreen kad `mustChangePassword` |

### 2.1 Shell i navigacija (FE-02, D-041)

- **Jedan spisak navigacije:** `src/components/layout/navigation.ts` (`NAV_SECTIONS`) — koriste ga
  sidebar, `<AppShell>` (naslov taba) i vidljivost po permisijama. Grupe: *Pregled · Posao · Teren ·
  Ured · Administracija*; ikona je uvijek uz tekst (nikad jedini nosilac značenja).
- **Aktivna stavka = najduži prefiks** (`activeNavPath`): `/fleet/map` gasi `/fleet`,
  a `/projects/:id` drži `/projects` aktivnim. `aria-current="page"` ide na aktivni link.
- **Vidljivost:** `isNavItemVisible` — `permission`, `anyPermission` (zadaci: `tasks.read` ili
  `tasks.dispatch`), `payroll` (uloge koje vide obračun) i `tenant` (stavke vezane za firmu su
  onemogućene dok firma nije izabrana). Guardovi na rutama ostaju mjerodavni — nav je samo UI.
- **Pristupačnost shella:** „Preskoči na sadržaj“ je prvi tabulator; `<main id="main">` prima fokus
  poslije navigacije; `document.title` je `<label> · Gradix`; skrol se resetuje na promjenu rute.
  Mobilni meni je `Sheet` sa `sr-only` naslovom i zatvara se klikom na stavku.
- **Lazy rute (D-015):** `fleet/map` (Leaflet), javni sajt, obračun i ERP se učitavaju tek kad se
  otvore, sa istim statusnim prikazom kao pri boot-u. Početni JS: **292.6 kB → 207.7 kB gzip**
  (budžet je 250 kB, D-015).

---

## 3. State i podaci

| Sloj | Alat | Pravilo |
|---|---|---|
| Server state | TanStack Query | keširaj po `[resurs, parametri]`; mutacije invalidiraju precizno, ne globalno |
| Auth/session | Zustand `auth-store` | access token **u memoriji**; refresh u `sessionStorage` („zapamti me“ ⇒ `localStorage`) |
| Tenant | Zustand `company-store` | PLATFORM_ADMIN bira firmu ⇒ `X-Company-Id` se dodaje u klijentu |
| Forme | react-hook-form + zod | ista pravila kao backend DTO (min dužine, formati) |
| i18n | i18next | nijedan korisnički tekst se ne piše direktno u JSX |

**Poznato:** `403 AUTH_PASSWORD_CHANGE_REQUIRED` i `401` se rješavaju na nivou `api` klijenta
(redirect na change-password / login), ne u svakoj stranici.

---

## 4. Design system

### 4.1 Trenutno stanje
- Tokeni su CSS varijable → Tailwind `@theme inline` (`--color-primary`, `--color-accent`, …).
- `index.css` definiše i dark varijantu (`@custom-variant dark`), ali je **niko ne aktivira**
  (web je light-only); mrtva grana — čisti se u FE-01.
- Boje iz starih pravila (primary `#1B365D`, background `#F4F1EA`, accent `#C45C26` …) su
  **polazna osnova**, ne obaveza (odluka D-008).

### 4.2 Obaveze za novi dizajn (D-008, odobreno)
1. **Nova paleta** je dozvoljena; brend smije evoluirati.
2. Minimalni set tokena: `color.{bg,surface,border,text,muted,primary,primary-fg,accent,
   success,warning,danger,info}`, `radius.{sm,md,lg,xl}`, `space.{…}`, `font.{sans,mono}`,
   `shadow.{sm,md,lg}`, `z.{…}`, `breakpoint.{sm,md,lg,xl}`, `motion.{fast,base,slow}`.
3. **Nijedna sirova vrijednost u komponenti** (`#hex`, `px` za spacing) — samo semantički token.
4. **WCAG 2.2 AA** je obavezan minimum: kontrast 4.5:1 (tekst) / 3:1 (veliki tekst i UI),
   vidljiv fokus (`focus-visible` prsten), ciljne površine ≥ 24×24 px, bez oslanjanja samo na
   boju, poštovanje `prefers-reduced-motion`.
5. Light tema je primarna; dark se uvodi samo ako se odobri (danas nije u obimu).

### 4.3 Admin dashboard — obavezan postupak
Prije implementacije: (1) informaciona arhitektura (navigacija, grupe, prečice), (2) wireframe
opis po ekranu, (3) lista komponenti i stanja (loading/empty/error/success) → **odobrenje
vlasnika** → tek onda kod.

---

## 5. Kvalitet i standardi (cilj, uvodi se u FE segmentima)

| Provjera | Danas | Cilj |
|---|---|---|
| Lint | `oxlint` | isto + dodatna pravila (a11y plugin) |
| Format | ❌ nema | `prettier --check` (jedan alat za cijeli monorepo) |
| Tipovi | `tsc -b` u CI-ju | isto + `strict` u svim paketima |
| Tokeni | ❌ nema provjere | skripta pada na sirovim bojama/spacing-u u komponentama |
| A11y | ❌ | `axe` u Playwright testovima za ključne ekrane |
| Testovi | 1 Playwright spec | page objects + fixtures po tokovima (vidi `TESTING.md`) |
| Bundle | nema budžeta | `vite build` + budžet po chunk-u (npr. initial < 250 kB gzip) |

---

## 6. Poznati dugovi (FE segmenti)

| # | Dug | Segment |
|---|---|---|
| F1 | Samo 1 E2E spec (login); nema testova za timer/ture/payroll/settings | FE-06 |
| F2 | Nema unit/component testova (npr. `planned-gantt`, `quantity-tab`, forme) | FE-05 |
| F3 | Nema design token guard-a; sirove boje u nekim komponentama (`❓` mjeri se u FE-01) | FE-01 |
| F4 | ~~Dark varijanta u CSS-u je mrtva~~ **riješeno** u FE-01 (`.dark` tokeni; klasa se još ne dodaje) | FE-01 |
| F5 | Nema a11y provjere (fokus, labele, kontrast, tastatura) | FE-03 |
| F6 | Admin dashboard nije redizajniran (informaciona arhitektura čeka odobrenje) | FE-04 |
| F7 | Nema `prettier`/format provjere; lint je samo oxlint | FE-02 |

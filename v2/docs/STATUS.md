# STATUS — Gradix v2

**Datum:** 2026-11-24 · **Grana:** `arena/44b867b0-gradix` · **Faza 0: završena (checkpoint).**

Realizacija ide po `docs/IMPLEMENTATION_PLAN.md` (odobren u cjelosti, strogi redoslijed).
Moduli 1–12 zaključani u `docs/specs/`. Sljedeće: **Faza 1 — jezgro i pristup (Modul 1)**.

## Šta je gotovo

| Korak | Sadržaj | Stanje |
|---|---|---|
| 0 | Monorepo, TS strict, dvije DB role (`gradix_app` / vlasnik), FORCE RLS + `app.company_id`, `withCompany`, preflight, CI | ✅ |
| 0.1 | Prilozi objedinjeni u jednu `attachments` tabelu (entitet + vrsta), S3 potpisi, MIME provjera | ✅ |
| 0.2 | Stare attachment tabele uklonjene; matrix parity pokazuje na novu tabelu | ✅ |
| 0.3 | Matrica dozvola kao kod (`packages/domain`): akcija × rola × stanje reference; `SELF_APPROVAL_FORBIDDEN`; iznimke sa rokom i razlogom ≥10 znakova | ✅ |
| 0.4 | `apps/worker` na pg-boss-u + obavještenja (`notifications`, inbox, zvonce, `/ured/obavjestenja`), `/api/health` (bez baze) i `/api/health/queue` | ✅ |
| 0.5 | Higijena: OpenAPI iz `ROUTES` + CI provjera ažurnosti, preflight kao CI gate, `AGENTS.md` osvježen, `STATUS.md` | ✅ |

## Brojevi (lokalna provjera, 2026-11-24)

```
migracije       35          tabele          49
OpenAPI         90 putanja
pnpm test       729 testova  (web 472 + domain 90 + mobile 80 + db 67 + contracts 20 + worker 8)
pnpm lint       6/6 · pnpm typecheck 6/6 · check-tenant-sql 425 upita ✓
check-matrix-parity 0 grešaka · check-application-coverage 0 grešaka · db:types:check ✓
```

Baza lokalno: embedded Postgres na portu 5433 (`v2/.pg/`, gitignorisano).

## Kako je Faza 0 provjerena

- **Worker stvarno radi**, nije samo kompajliran: `ping.health` se izvršio dva puta sa
  `REMINDER_INTERVAL_MINUTES=1`, proces se ugasio uredno, `queueHealth()` je nad tom bazom
  vratio `available:true, completed:4, active:0, stuck:0, stale:false`.
- **Obavještenja protiv žive baze** (`notification.integration.test.ts`, 6 testova): dedupe po
  `dedupe_key`, validacija bez primaoca i bez `href`, tuđe se ne vidi ni ne označava, druga firma
  ne vidi ništa, email bez SMTP-a je `BLOCKED_NO_PROVIDER` i poruka ostaje u inboxu, retencija
  90 d / 1 g / 2 g.
- **Testovi su hvatali prave greške**, ne samo prolazili: `SafeText` je uhvatio `z.string()` u
  `NotificationReadInput` (NUL bi ušao u bazu), `tokens.test.ts` je uhvatio hardkodirani heks u
  `shell.css`, a worker test je uhvatio da `loadConfig(env)` čita `process.env` umjesto `env`.

## Odluke na snazi (iz modula 1–12)

2FA TOTP za OWNER/ADMIN/ACCOUNTANT · pg-boss, **bez Redisa** · jedan `cost_entries` sa 8
`source_type` · satnice samo OWNER/ADMIN/ACCOUNTANT · `SELF_APPROVAL_FORBIDDEN` · cisterna je
skladište `TANK` · situacije prema naručiocu van MVP-a (B15) · dashboard po roli ·
`notifications` sa obaveznim `href` i `dedupe_key` · audit retention 2/5/10 g · `Cmd/Ctrl+K` pod
RLS-om · **bez** AI/vektorske pretrage i **bez** kvalifikovanog e-potpisa u MVP-u.

## Namjerno još nema

- 4 od 6 worker poslova (`reminders.scan`, `budget.thresholds`, `attachments.purge`,
  `sync.purge`) — dolaze sa svojim modulima, jer traže tabele koje još ne postoje.
- Email/push provajder: isporuka je `BLOCKED_NO_PROVIDER`, in-app radi bez njega.
- `report_jobs`, `daily_rollups`, `user_devices` — Faza 1.

## Dugovi

- CI job traje ~9 min; kandidat za keširanje `pnpm` store-a.
- `check-matrix-parity` upozorava na jedan `NOT_IMPLEMENTED` (tenant lista do R2) — svjesno,
  zatvara se kad Faza 1 doda tabele R3–R7.
- Maestro tokovi pokrivaju samo R0 offline tokove; šire se kad mobilni dobije Fazu 1 ekrane.

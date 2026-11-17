# STATUS — Gradix v2

**Datum:** 2026-11-16 · **Grana:** `v2-bootstrap` · Pregled (b0c419d) odobren.

## Radi (dokazano testovima u CI-ju)

- **Pristup (R1):** prijava, pozivnice, reset, deaktivacija, rate limit u bazi.
- **Navigacija i sesija (A/A2):** meni po roli, 403 bez tihog redirecta, odjava → prijava;
  čuvar sesije samo na 401 (`session-watch`, E2E).
- **Pregled (C.1):** „šta moram danas“ — odobren + implementiran (`b0c419d`); seed
  `demo-pregled` + E2E po rolama.
- **Radni dani / opsezi (R3):** view po matrici; SELF/PROJECTS samo na serveru.
- **Evidencija (R2/R3):** radnici, mašine, uvoz Excel, rokovi, projekti/dodjele.
- **Teren (R4 + Step 7):** Moj dan / Grupa; SQLite outbox; push/pull; sukob → Za provjeru.
- **Razrješenje sukoba (R4a-2):** web `/ured/sukobi` + pull ishoda na telefon.
- **UI (U):** katalog; lista izuzetaka prazna; CI: ESLint, check-ui, check-contrast, axe.
- **Backup/restore (C.2):** `v2-backup-restore.yml` — šifrovani dump → restore → manifest →
  preflight → prijava; dokazi (a)(b)(c)(d). Odredište: app MinIO, zaseban bucket + ključevi;
  `BACKUP_ENCRYPTION_KEY` van MinIO-a. Retencija: 30 lokalnih / dnevni job (§12 COOLIFY).
  RTO demo = 2 s (run 43874147777). Seed: `SEED_PASSWORD` + `pnpm seed` (demo nalozi).

## Role — ko šta vidi

| Rola | Web (meni) | Mobilni | Ne vidi |
|---|---|---|---|
| OWNER | sve | Moj dan / Grupa po vezi | tuđe firme (RLS) |
| ADMIN | kao vlasnik (− upravljanje vlasnikom) | isto | vlasnika |
| PROJECT_MANAGER | Projekti, Rokovi, Mašine, Radnici, Radni dani (opseg) | po vezi | Korisnici, Uvoz |
| SITE_SUPERVISOR | Radnici, Mašine, Projekti, Rokovi, Radni dani (opseg) | Grupa / Moj dan | Korisnici, Uvoz |
| WORKER | Pregled, Projekti, Rokovi, Mašine (SELF) | Moj dan | Radnici, Korisnici |
| DRIVER | Pregled, Projekti, Rokovi, Mašine (SELF) | Moj dan ako povezan | uredsko van opsega |
| MACHINE_OPERATOR | Pregled, Mašine, Projekti, Rokovi | Moj dan | Radnici, Korisnici |
| MECHANIC | Pregled, Mašine, Projekti, Rokovi | Moj dan ako povezan | Radnici, Korisnici |
| ACCOUNTANT | Pregled… + Radni dani (čitanje) | Moji rokovi/projekti | Korisnici, Uvoz |

## Ne radi / namjerno još nema

- **R4b (potvrda sedmice):** nije započet.
- **Mobilni E2E u CI:** Maestro postoji; CI zatvoren — vlasnik po `DEMO-STEP7` / checklisti.
- **A1 prijava na mobilnom poslije odjave:** nije još testirano (vlasnik).
- **Redis:** samo dijagnostika; rate limit u bazi.
- **Katalog:** nije javan; nije u produkcijskom mobilnom bundleu.

## Dugovi

- **PLATFORM_ADMIN_EMAILS:** privremeno; zamijeniti pravim platform korisnicima.

## Otvoreno

1. Staging deploy + prolaz po rolama.
2. Pilot: `PILOT.md`; `SEED_DEMO` se gasi samo `remove-demo.ts`.
3. Produkcija: ugasiti javnu MinIO konzolu; backup raspored (§12.2 COOLIFY) — odvojeni
   servis, ne trajni BACKUP_* na webu; poslije drill-a cleanup (§12.1).
4. Plan 2c (neuredni Excel): sekcija u `PILOT.md` — čeka odobrenje vlasnika prije koda.

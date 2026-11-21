# E2E coverage matrix (A3 + B2)

Status: **active** · 2026-11-20  
Kapija: CI `ci-v2` ephemeral Postgres + seed + in-job web.  
Viewport: `desktop` + `mobile` (Pixel 5), osim `@snimci` (desktop only).

**MinIO odluka (Faza 2b):** attachment deep ishodi = **CI-SKIP** (nema MinIO service u `ci-v2`). Prilozi pokriveni unit/integracijom gdje postoji; deep E2E ne zahtijeva upload.

| module | matrix_ref | outcome | spec | tag | roles | desktop | mobile | status | notes |
|---|---|---|---|---|---|---|---|---|---|
| Auth/nav | nav + sesija | login/logout/menu/403 | `navigation.spec.ts`, `smoke.spec.ts` | `@smoke` | sve seed | da | da | covered | helpers |
| Auth sesija | A1e | re-login + revoke tab | `navigation.spec.ts` | `@deep-auth` | OWNER/ADMIN | da | da | covered | |
| Evidencija Partneri | partners / R7.1 | create CLIENT + UI lista | `evidencija-deep.spec.ts` | `@deep-evidencija` | ADMIN | da | da | covered | self-owned `ptr_e2e_*` |
| Evidencija Tenderi | tenders MATRIX | DRAFT→SUBMITTED→WON→convert | `evidencija-deep.spec.ts` | `@deep-evidencija` | ADMIN | da | da | covered | `tnd_e2e_*` |
| Evidencija Tenderi | tenders MATRIX | invalid DRAFT→WON; LOST | `evidencija-deep.spec.ts` | `@deep-evidencija` | ADMIN | da | da | covered | |
| Evidencija Tenderi prilozi | tenders attachments | upload ready | — | — | — | — | — | **CI-SKIP** | MinIO odluka 2b |
| Evidencija Projekti/Radnici/Mašine | projects/workers/equipment | API create + UI | `evidencija-deep.spec.ts` | `@deep-evidencija` | ADMIN | da | da | covered | |
| Evidencija Rokovi | obligations | page + forbidden | `evidencija-deep.spec.ts` | `@deep-evidencija` | ADMIN/WORKER | da | da | covered | |
| Evidencija Uvoz | import | happy + mixed errors | `import-projects.spec.ts` | `@deep-evidencija` | ADMIN | da | da | covered | |
| Mehanizacija Sati | R5.1 | API + UI | `mehanizacija-deep.spec.ts` | `@deep-mehanizacija` | ADMIN | da | da | covered | |
| Mehanizacija Gorivo | R5.2 | API + UI | `mehanizacija-deep.spec.ts` | `@deep-mehanizacija` | ADMIN | da | da | covered | |
| Mehanizacija Ture | R5.3 | API + UI | `mehanizacija-deep.spec.ts` | `@deep-mehanizacija` | ADMIN | da | da | covered | |
| Mehanizacija Pregled/Kvarovi | R5.4/5.5 | page render | `mehanizacija-deep.spec.ts` | `@deep-mehanizacija` | ADMIN | da | da | covered | attachments CI-SKIP |
| Rad approval | R4b | confirm/approve/lock | `approval.spec.ts` | `@deep-rad` | SEF/ADMIN/ACC | da | skip | covered | mobile skip (drawer/layout) |
| Rad revise | R4b | revise + roles | `revise.spec.ts` | `@deep-rad` | multi | da | skip | covered | mobile skip |
| Rad resolve | R4a | conflict resolve | `resolve.spec.ts` | `@deep-rad` | ADMIN/OWNER | da | da | covered | |
| Rad troškovi/CSV | R6 | pages + forbidden | `rad-deep.spec.ts` | `@deep-rad` | ADMIN/WORKER | da | da | covered | |
| Admin | users/roles/audit | render + 403 | `admin-deep.spec.ts` | `@deep-admin` | OWNER/WORKER | da | da | covered | |
| Pregled C.1 | dashboard | pažnja/sync po roli | `navigation.spec.ts` | `@deep-admin` | multi | da | da | covered | |
| Snimci | Dio 3c | artefakt | `snimci.spec.ts` | `@snimci` | OWNER | da | ne | covered | nije kapija |

## Shard komande (CI)

```
E2E_GREP=@smoke playwright test
E2E_GREP=@deep-auth …
E2E_GREP=@deep-evidencija …
E2E_GREP=@deep-mehanizacija …
E2E_GREP=@deep-rad …
E2E_GREP=@deep-admin …
E2E_GREP=@snimci playwright test --project=desktop
```

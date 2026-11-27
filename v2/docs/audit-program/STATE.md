# STATE — Program audita Gradix

- Datum snimka: 2026-11-27.
- Aktivna faza: 1 — Modul 1 vlasnička trijaža djelimično zaključena; odluke su zabilježene u modulskoj dokumentaciji.
- Modul u radu: 01 — vlasnik potvrdio S1/S2/S3 mapu, uključujući F1-04c S1; platform operator MFA ostaje bez težine.
- Grana: `arena/7b5ea9bf-gradix` (active), bazna grana `v2-bootstrap`.
- Kodni baseline pregledan: `e7a37910a9c0a651d3d77a059592d755330b399c`; G0 commit/push: `045e0e03bbfb8af0a9390c864453cb1b427fcfae`.
- Urađeno: statička triangulacija spec 01, ADR 0003/0005/0007/0013/0017, API/UI, servisa, migracija/ACL-a, testnih ankera i quality registra.
- Kreirani/ažurirani: `01-firme-korisnici-role-audit/{01-AUDIT,02-DIZAJN,03-PLAN,04-MATRICA}.md`; unesene potvrđene težine i odluke.
- Uočeni kandidati: platform runtime principal/onboarding/MFA-support; password expiry; role-change session revoke; audit retencija/readovi; pozivnice/reset; user settings; sesijski UI/telemetrija; osjetljive dozvole.
- Nije mijenjan poslovni kod; implementacija nije odobrena. Potrebna je `KREĆEMO U KODIRANJE: 1` prije koda.
- Dokumentacijske provjere: trijažni dokumenti, lokalne Markdown veze i citirane putanje provjereni; `git diff --check` čist; svaki dokument <3.000 riječi.
- Testovi, typecheck, lint, quality checker, build, DB preflight, deploy/pilot nisu pokretani.
- Sljedeće: odlučiti platform operator MFA i dobiti pravnu/računovodstvenu potvrdu prije purge; potom zasebna vlasnička fraza ako se želi kodirati.
- Otvoreno: platform operator MFA; legal/finance sign-off za purge; tačni ACL grantovi; lokalizacijski obim; dokumentacijsko brojanje 11/12. Višefirmski UI ostaje `ODLOŽENO` prema MVP specu.
- G0 pitanja iz `G0-IZVJESTAJ.md` (pilot-ready ref/status, C.1, migracije poslije datuma snimka) ostaju bez nezavisne provjere.
- Programski G1 slijedi tek nakon svih 12 modula i `00-UKRSTENO.md`; Etapa B i kodiranje imaju zasebne vlasničke kapije.

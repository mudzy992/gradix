# 0009 — Opseg „dodijeljeni projekti“ i dodjela kao tabela

**Datum:** 2026-11-09 · **Status:** prihvaćeno · **Rez:** R3

## Kontekst

`scope` je od R1a kolona na `memberships` sa tri vrijednosti u `CHECK`-u
(`COMPANY`, `PROJECTS`, `SELF`). U R1b je `PROJECTS` **sklonjen** iz `CHECK`-a i iz `@gradix/domain`,
jer u tom rezu nije postojao nijedan entitet nad kojim bi opseg nešto mijenjao. Pravilo je tada
zapisano u `docs/PLAN-R3.md`: opseg koji ne vidi ništa je gori od opsega koji još ne postoji, jer
izgleda kao da štiti.

R3 uvodi `projects` i dodjele, pa opseg prvi put ima šta da ograniči.

## Odluka

1. **`PROJECTS` se vraća** u `SCOPES` i u `CHECK`. Rješava se u `resolveScope`, na jednom mjestu, uz
   novu funkciju `visibleProjectIds` koja daje ulaz za `WHERE` (`null` = bez filtera za `COMPANY`,
   prazan niz = nijedan za `SELF`).
2. **Dodjela je tabela `project_assignments`**, ne `memberships.project_ids`. Niz ne može nositi
   FK, period važenja ni historiju; dodjela mašine se u niz ne može upisati nikako.
3. **Opseg se izvodi iz dodjele radnika**, preko radnika vezanog za nalog (`workers.user_id`).
   Dodjela mašine ne daje nikome vidno polje — opseg prati ljude.
4. **Opseg `PROJECTS` bez ijedne dodjele se odbija** pri snimanju članstva.
5. **Tuđi projekat u istoj firmi = 403, tuđa firma = 404.**
6. **Nepoznat opseg u bazi pada na `SELF`**, nikad na `COMPANY`.

## Zašto 403 za tuđi projekat, a 404 za tuđu firmu

Razlika je namjerna i nije nedosljednost. Čovjek sa opsegom `PROJECTS` mora znati **je li projekat
obrisan ili mu nije dodijeljen** — to su dvije različite situacije sa dvije različite radnje (zvati
ureda zbog dodjele, ili ne tražiti ono što ne postoji). Firma B, s druge strane, ne postoji u
njegovom svijetu: RLS je ne vidi, pa ni odgovor ne smije reći da postoji.

## Posljedice

- Svaka ruta nad projektima dobija `scope` i `projectIds` iz sesije (`AuthContext`), ne iz zahtjeva.
  Da se čitaju iz upita, čovjek bi sam sebi proširio vidno polje jednim parametrom.
- `authenticate` radi **jedan dodatni upit** i to samo za opseg `PROJECTS`; `COMPANY` i `SELF` ne
  plaćaju ništa.
- Promjena opsega važi **odmah** (opseg se čita uz sesiju, ne nosi se u tokenu) — isto pravilo kao
  deaktivacija naloga u R1a.
- Migracija je aditivna; vraćanje na `COMPANY`/`SELF` je jedna izmjena `CHECK`-a i jedan `switch`.

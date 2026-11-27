# Izvještaj — Faza 2: Obaveze s rokom

**Datum:** 2026-11-23 · **Grana:** `arena/44b867b0-gradix` · **Tag:** `phase-2` · **CI:** zelen

Spec: `docs/specs/02-obaveze-s-rokom.md`. Odluke: `docs/DECISIONS/0016-obaveze-bez-roka-i-provjera.md`.

## Šta sada radi, a prije nije

| Prije F2                                                      | Poslije F2                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Obaveza je „nešto sa datumom isteka"                          | Obaveza je ili **s rokom** ili **trajna sa datumom provjere** — treće ne postoji  |
| Trajna obaveza je bila „vječno važeća" (tj. nikad provjerena) | Bez `review_at` je baza **odbija** (odgođeni constraint trigger)                  |
| Ured je ručno znao šta mu nedostaje                           | Firma ima **pravila** i spisak nedostajućih obaveza, sa kreiranjem u jednom kliku |
| Provjera dokumenta nije postojala                             | `pending_review` / `rejected` sa razlogom; odbijeno **blokira** rad               |
| Podsjetnik je išao na fiksnu adresu                           | Ide **rolama po tipu obaveze** (`obligation_notify_roles`)                        |
| Izvoz/uvoz: ručno prepisivanje                                | CSV i PDF izvoz, uvoz sa pregledom prije primjene                                 |
| Mobilni: „isteklo" i „uskoro istječe" isto                    | Blokada (`danger`) se razlikuje od upozorenja (`warn`)                            |

## Obim

- **Baza:** 1 migracija (`20261124130000_f2_1_obligation_requirements`) — 8 novih kolona na
  `obligation_types`, 6 na `obligations`, dvije nove tabele sa FORCE RLS, seed pravila po firmi,
  odgođeni constraint trigger. 61 tabela ukupno (bilo 59).
- **Ugovor:** +10 ruta (119 putanja u OpenAPI-ju), 6 novih šema, `MissingObligation` tip.
- **Domena:** `BLOCKING_OBLIGATION_STATES`, 9 stanja, `isBlockingState` odvojen od `signalBlocksAction`.
- **API:** 10 ruta, 3 nova servisa (pravila, izvoz, uvoz), +10 audit akcija, +2 dozvole.
- **UI:** `/ured/rokovi` (9 stanja, kartica „Nedostaje"), mobilni ekran rokova.
- **Worker:** 2 nova posla (`reminders.scan`, `attachments.purge`) → 4 od 6 ukupno.

## Verifikacija

| Provjera                                     | Rezultat                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm test`                                  | **871 test** u 6 paketa (web 521, domain 158, mobile 85, db 67, contracts 21, worker 23) |
| `pnpm typecheck`                             | 6/6 zadataka                                                                             |
| `pnpm lint`                                  | čist                                                                                     |
| `pnpm build`                                 | web + worker                                                                             |
| `db:types` / `db:types:check`                | 61 tabela, tipovi sinhroni sa bazom                                                      |
| preflight (`001_security`, `002_privileges`) | oba OK, efektivni grantovi = matrica                                                     |
| `check-tenant-sql`                           | 53/53 tenant tabela, svi upiti nose `company_id`                                         |
| CI `verify`                                  | **success** (run 45405036008)                                                            |

## Greške koje su uhvaćene i šta su naučile

1. **CHECK ne može provjeriti `expires_at OR review_at`** — `expires_at` piše trigger poslije
   INSERT-a. Rješenje: odgođeni constraint trigger koji ponovo čita red. _Nauka:_ ograničenje
   koje zavisi od drugog triggera mora biti trigger.
2. **Redoslijed validacije je dio ugovora.** „Ljekarski na mašini" mora prijaviti rod entiteta, a
   ne datum provjere. Blok je morao stajati poslije provjere `matches`, ne prije.
3. **`isBlockingState` ne smije zavisiti od radnje.** Spajanje sa `signalBlocksAction` je tiho
   uklonilo upozorenje pri evidentiranju goriva — gorivo bi prolazilo bez ijedne opomene.
4. **Lokalno zeleno ≠ CI zeleno.** Dvije F2 tabele nisu bile u `TENANT_TABLES`; lokalno se
   unakrsna provjera s katalogom preskače (nema `psql`), u CI-ju pada. Isto sa `privilege-matrix`:
   `grants.sql` je davao `DELETE` na `notify_roles`, matrica ga nije dopuštala.
5. **`response: null` nije dopušten** u `RouteSpec` — fajl-odgovor je `z.string()` + `raw: true`.

## Dugovi (nova Faza 2 ne uvodi nijedan)

Otvoreno iz ranije: E2E stabilnost na 20 resetova, parity `R1.tenant.tables-through-r2`
`NOT_IMPLEMENTED`, platform sesija bez refresh-a, support pristup se auditira ali ne impersonira,
`maestro/offline-unos.yaml` van CI-ja.

**Zatvoreno u F2:** `obligations_project_not_before_r3 CHECK (project_id IS NULL)` — uklonjen još
u R3 migraciji (`20261109120000_r3_projekti`), dug je bio samo u dokumentaciji. F2 sada upisuje
`project_id` bez prepreke.

## Sljedeće

**Faza 3 — Evidencija rada** po `docs/IMPLEMENTATION_PLAN.md`.

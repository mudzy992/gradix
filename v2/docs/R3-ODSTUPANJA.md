# R3 — odstupanja od PLAN-R3

Deset stavki gdje kod ne radi tačno ono što piše u `docs/PLAN-R3.md`, sa razlogom. Sve su posljedica
nečega što se vidi tek kad se napiše — nijedna nije „lakše je bilo ovako".

| # | Plan kaže | Urađeno | Zašto |
|---|---|---|---|
| 1 | Opseg `PROJECTS` preko `memberships.project_ids` | Tabela `project_assignments` | Niz ne nosi FK, period važenja ni historiju, a dodjelu **mašine** u njega ne možeš upisati nikako. Detalji: ADR 0009. |
| 2 | Preklapanje brani `EXCLUDE USING gist` | Migracija prvo pokuša `EXCLUDE`; ako nema `btree_gist`, ostaje triger sa `pg_advisory_xact_lock` | `btree_gist` je trusted na PG16 **ako je contrib instaliran** — u CI slici jeste, u goloj instalaciji nije. Migracija koja pada zbog ekstenzije obara deploy, a ne test. Oba puta ostaje **tačno jedan** mehanizam; test to tvrdi. ADR 0010. |
| 3 | Dozvola `projects.assign` (OWNER, ADMIN, PM) | Dodata **`projects.override`** (OWNER, ADMIN) | Bez nje bi ko dodjeljuje mogao sam sebi ugasiti blokadu iz B5.4 — pravilo bi važilo samo protiv onih koji ne mogu dodijeliti. Traženje iznimke i njeno odobravanje su dvije radnje. |
| 4 | `projects.view` za „sve uloge koje vide projekat" | Data i `WORKER`-u i `DRIVER`-u | Radnik mora znati na kojem je projektu; bez toga mobilni ekran „Moji projekti" ne postoji. |
| 5 | Iznimka = razlog (≥ 10 znakova) + **rok** | Rok **obavezan samo za odobrenu** iznimku; zahtjev ga nema | Zahtjev još nije odobren, pa niko nije odredio dokle važi. Rok upisuje onaj ko odobrava — inače tražilac sam sebi piše pravilo. |
| 6 | Iznimka se upisuje uz dodjelu | Zahtjev (`assignment_id` NULL) → odobrenje pretvara isti red u iznimku | Jedan red nosi cijeli tok (traženo → odobreno) i historija je čitljiva bez duplog zapisa. Migracija `20261109170000`. |
| 7 | Opseg `PROJECTS` bez dodjele se odbija pri snimanju | **+ skidanje zadnje dodjele spušta opseg na `SELF`**, uz audit i vidljivu poruku | Odbijanje pri snimanju ne pokriva trenutak kad dodjela nestane. Bez ovoga čovjek ostane sa opsegom koji ne vidi ništa — prazan ekran bez objašnjenja. Uz to je nađena greška: prazan opseg je rušio listu projekata (500). ADR 0010. |
| 8 | Seed: firme, korisnici, mašine, radnici | **+ 2 projekta i 5 dodjela**, i 9 zadanih tipova obaveza za projekat (u migraciji) | Demo bez projekta ne pokazuje ništa što R3 uvodi; kapija uživo traži projekat sa timom. Tipovi idu u migraciju da ih i postojeće firme dobiju bez ponovnog seedovanja. |
| 9 | Mobilni: samo „Moji projekti" (čitanje) | Dodat lokalni keš (`projects_cache`) i „od prije X" | Jedini ekran u R3 koji radi bez mreže; bez keša na gradilištu nema ničega. Isto pravilo kao rokovi iz R2b. |
| 10 | Kapija R3: 6 koraka | **8 koraka** (dodati: PM traži / vlasnik odobrava; skidanje zadnje dodjele) | Prva dva nova pravila iz ovog pregleda nisu imala korak na kapiji — pravilo bez provjere uživo je tvrdnja, ne stanje. |

## Nije odstupanje, ali treba znati

- **`WORKER` ne može otvoriti `/api/obligations`** (nema `obligations.view`), pa mu mobilni ekran
  „Rokovi" vraća 403. To je posljedica R2b matrice, a ne R3. **Otvoreno pitanje za vlasnika** — vidi
  izvještaj; nije mijenjano bez odluke.
- **`btree_gist` u sandboxu nije instaliran**, pa lokalno uvijek radi triger. EXCLUDE put je zato
  provjeren u CI-ju (`postgres:16-alpine`), gdje je i pao prvi put — i to je dovelo do popravke
  prepoznavanja SQLSTATE 23P01.

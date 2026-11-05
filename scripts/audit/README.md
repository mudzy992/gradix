# scripts/audit — inventar i gate pokrivenosti

Bez zavisnosti (samo Node 22 builtin). Ne treba `npm install`.

| Skripta | Šta radi | Kada se pokreće |
|---|---|---|
| `report-e2e.mjs`, `report-e2e.test.mjs` | Fail-closed backend Jest proces/JSON reporter i izolovane regresije; bez novih zavisnosti | backend E2E / audit CI |
| `inventory.mjs` | Skenira repo, klasifikuje svaki izvorni fajl u `layer/module/segment`, upisuje `AUDIT/COVERAGE_MATRIX.csv` | ručno kad se doda/pomjeri fajl |
| `inventory.mjs --stats` | Isto, ali samo ispiše statistiku (ništa ne piše) | orijentacija |
| `check-coverage.mjs` | CI gate: matrica vs. kod vs. `segments.json` | CI job `audit`, lokalno prije commita |
| `inventory-scaffold.test.mjs` | Regresije sigurnog inventara i zabrane prepisivanja izvještaja | CI audit i lokalno |
| `check-audit-gate.mjs` | Strogi gate: integritet inventara, usklađeni izvještaji, pregledani fajlovi u `done`, te CI dokaz | CI audit i lokalno |
| `check-audit-gate.test.mjs`, `verify-ci-evidence.mjs` | Izolovane regresije i online potvrda punog GitHub CI runa | CI audit i lokalno |
| `check-coverage.test.mjs` | Izolovani testovi ispravne i oštećene matrice | `node --test scripts/audit/check-coverage.test.mjs` i CI job `audit` |
| `lib.mjs` | zajednička logika: `collectFiles`, `classify`, CSV parser, `readSegments` | — |

## Tok rada

```bash
node scripts/audit/inventory.mjs        # 1. poslije dodavanja/pomjeranja fajlova
node scripts/audit/check-coverage.mjs   # 2. gate mora reći PASS
git add AUDIT/COVERAGE_MATRIX.csv
```

CI job `audit` pušta gate pa **regeneriše** matricu i pada ako se fajl promijeni — matrica se ne
smije ručno „popravljati“, samo generisati.

## Kolone matrice

| Kolona | Značenje |
|---|---|
| `file` | putanja od korijena repoa (jedinstvena) |
| `layer` | `STD` \| `CI` \| `INF` \| `BE` \| `FE` \| `MOB` \| `TEST` |
| `module` | logička cjelina unutar sloja (npr. `ops`, `ui`, `offline`) |
| `segment` | ID segmenta iz `segments.json` (npr. `BE-05`) |
| `loc` | broj linija (generisano) |
| `status` | vidi tabelu ispod |
| `findings` | kratak nalaz; **obavezan** za `pregledano`, `popravljeno` i `pokriveno-testom` |
| `date` | ISO datum zadnje izmjene statusa |

## Statusi

| Status | Znači | Traži `findings` + `date` |
|---|---|---|
| `nepregledano` | još nije otvoren | ne |
| `u-toku` | čita se / analizira se | ne |
| `pregledano` | pročitan, nalaz zapisan, ništa nije mijenjano | da |
| `popravljeno` | nalaz riješen u kodu | da |
| `pokriveno-testom` | ponašanje zaključano testom | da |

`inventory.mjs` **nikad** ne prepisuje `status`/`findings`/`date`; mijenja samo `layer`, `module`,
`segment`, `loc`. Neispravna matrica, duplikati, nepoznat segment ili red za nestali fajl zaustavljaju upis; nalaz o nestalom fajlu mora se prvo pregledati i arhivirati. Završeni sadržaj se atomarno zamjenjuje. `scaffold-segments.mjs --force` se odbija kako se postojeći izvještaji ne bi prepisali.

## Šta gate provjerava

1. Matrica postoji, header tačan; duplikati, neispravno CSV citiranje, nedostajuće putanje i pogrešan broj kolona ruše gate. Polje matrice mora biti u jednom fizičkom redu; višelinijski CSV nije podržan.
2. Svaki fajl iz `collectFiles()` ima red; nema redova za nepostojeće fajlove.
3. `layer/module/segment` se poklapaju sa klasifikacijom (drift = pad).
4. Status je iz liste; pregledani statusi imaju `findings` i stvaran kalendarski ISO `date` (YYYY-MM-DD).
5. Svaki segment sa `scope: "files"` ima ≥1 fajl; nepoznat segment u matrici = pad.
6. `segments.json` validan (unikatni ID-evi, sloj odgovara ID-u, poznat status).

## Izuzeti fajlovi (svjesno)

`node_modules`, `.git`, `dist`, `coverage`, `backend/generated`, `.expo`, `mobile/assets`,
`package-lock.json`/`*.lock`, `*.md`, `docs/`, `AUDIT/`, `LICENSE`, `.gitignore`.
Dokumentacija ima svoj guard (STD-02); binarni resursi i generisani fajlovi nemaju šta da se
auditiraju. Sve ostalo **mora** biti u matrici.

## Process segmenti

17 segmenata je poprečno (npr. CI-02…CI-07 dijele jedan `ci.yml`, FE-03 je a11y kroz sve ekrane,
MOB-07 je EAS profil koji još ne postoji). Oni u `segments.json` imaju `scope: "process"` i
`scopeReason`; gate za njih ne traži redove u matrici; nedostajući razlog je upozorenje, ne greška.

Prototip `check-audit-gate.mjs` najprije izvršava `check-coverage.mjs` i pada ako matrica/inventar nisu usklađeni. Ostaje van CI gatea dok postoje nepregledani zapisi u `done` segmentima. Provjerava i prisustvo izvještaja svih segmenata te status u zaglavlju i zapisu izvršavanja prema registru; format izvještaja je ograničen na postojeći obrazac. Njegova CI provjera je tekstualna, ne parsira proizvoljan YAML: neke alternativne `uses` ključeve i inline korake odbija, ali ne dokazuje sigurnost drugih oblika, aliasa ni lokalnih akcija; provjerava i tačnu dokumentovanu suite matricu šest poslova. Promjena formata ili dodavanje posla zahtijeva usklađivanje provjere; testovi prototipa pokreću se u izolovanom repou.

## Strogi audit gate

`node scripts/audit/check-audit-gate.mjs` provjerava kompletnost inventara, postojeće
izvještaje i njihove statuse, te za `done` segmente traži isključivo pregledane redove i
jedan `Potvrđeni puni CI` link s ID-om i `success` u zaglavlju izvještaja. Nedovršeni
segmenti mogu imati `nepregledano` i `u-toku`, ali integritet matrice i dalje važi za sve.
U CI-ju `--verify-ci` uz `GITHUB_TOKEN` i `actions: read` provjerava GitHub API: isti
repozitorij, završeni uspješni CI workflow i svih šest uspješnih poslova. Greška API-ja,
nedostupan token, nedostajući ili preskočen posao ruše gate. Lokalni poziv bez opcije
provjerava samo format tvrdnje, **ne** provjerava GitHub. Referenca je dokaz punog CI-ja
za snimljeni kod, ne sama po sebi dokaz kvaliteta pregleda niti da je to završni commit
segmenta. Po završetku promjene sačekati puni CI prije tvrdnje da je nova revizija zelena.
Parser workflowa je namjerno ograničena tekstualna provjera, ne opšti YAML parser.

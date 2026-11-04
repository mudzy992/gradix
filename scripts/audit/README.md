# scripts/audit — inventar i gate pokrivenosti

Bez zavisnosti (samo Node 22 builtin). Ne treba `npm install`.

| Skripta | Šta radi | Kada se pokreće |
|---|---|---|
| `inventory.mjs` | Skenira repo, klasifikuje svaki izvorni fajl u `layer/module/segment`, upisuje `AUDIT/COVERAGE_MATRIX.csv` | ručno kad se doda/pomjeri fajl |
| `inventory.mjs --stats` | Isto, ali samo ispiše statistiku (ništa ne piše) | orijentacija |
| `check-coverage.mjs` | CI gate: matrica vs. kod vs. `segments.json` | CI job `audit`, lokalno prije commita |
| `inventory-scaffold.test.mjs` | Regresije sigurnog inventara i zabrane prepisivanja izvještaja | CI audit i lokalno |
| `check-audit-gate.test.mjs` | Izolovane regresije prototipa strogog gatea; sam prototip još nije obavezan u CI | CI audit i lokalno |
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
| `findings` | kratak nalaz; **obavezan** čim status nije `nepregledano` |
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

1. Matrica postoji, header tačan; duplikati, nedostajuće putanje i pogrešan broj kolona ruše gate.
2. Svaki fajl iz `collectFiles()` ima red; nema redova za nepostojeće fajlove.
3. `layer/module/segment` se poklapaju sa klasifikacijom (drift = pad).
4. Status je iz liste; pregledani statusi imaju `findings` i ISO `date`.
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
`scopeReason`; gate za njih ne traži redove u matrici, ali traži razlog.

Prototip `check-audit-gate.mjs` ostaje van CI gatea dok postoje nepregledani zapisi u `done` segmentima. Njegova provjera CI okidača namjerno prihvata samo trenutni jednostavni YAML block-format, ne parsira proizvoljan YAML; provjerava i tačnu dokumentovanu suite matricu šest poslova. Promjena formata ili dodavanje posla zahtijeva usklađivanje provjere; testovi prototipa pokreću se u izolovanom repou.

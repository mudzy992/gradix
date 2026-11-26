# Faza 11A — radni zapis (nije završena)

## Baza

Migracija `20261128100000_f11_search_reports_foundation` uvodi `pg_trgm` i GIN indekse za projekte, imena radnika, mašine, tendere, partnere, nazive priloga i brojeve faktura. Dodaje projektni ključ za rollup s posebnim unikatnim indeksima za stare zbirne i nove projektne redove; ledger može imati negativan neto zbog OFFSET-a. U `report_jobs` dodaje metapodatke za sedam vrsta izvještaja, format, JSON parametre, vezu na prilog i opcioni dedupe ključ. FORCE RLS i postojeća prava ostaju na snazi. Ovo je samo šema: indeksi ne znače da API pretraga već postoji, a kolone ne znače da motor izvještaja radi.

Upgrade test na zasebnoj bazi s postojećim rollup/report redovima provjerava očuvanje, unikate, projekt iz druge firme, 12 indeksa i tenant izolaciju. Novi test i F10 migracijski testovi: 6/6 PASS. `db:types:check`, lint, typecheck, check-cycles i check-tenant-sql PASS. `preflight-checks/run.sh` ne radi lokalno jer nedostaje `psql`; oba SQL fajla su zasebno izvršena preko Node PostgreSQL klijenta s aplikacijskom rolom i prošla. Worker unit test 22 PASS, 3 integracijska preskočena bez DB URL-a.

## Nezavršeno / ozbiljan nalaz

Preporučeni worker konfiguracijski prioritet je `DATABASE_URL` (aplikacijska rola). Provjera nad lokalnom bazom: administratorska rola vidi 42 aktivne firme, a `gradix_app` bez tenant konteksta vidi 0. `reminders.scan`, `budget.thresholds` i `attachments.purge` prvo globalno čitaju `companies` bez tenant konteksta pa mogu tiho preskočiti sve firme; `sync.purge` globalno čita RLS tabelu bez tenant konteksta. Potrebno je osmisliti i testirati ograničen worker principal/enumeraciju i odvojene tenant transakcije bez otvaranja pristupa web aplikaciji. Ne koristiti ovaj rezultat kao dokaz da postojeći poslovi rade u produkciji.

Nisu implementirani ni aktivirani `rollup.nightly`, `reports.scheduled`, 7 izvještaja, asinhroni poslovi i attachment preuzimanje, export lista, dashboard po rolama, `data_health` ili globalna pretraga. Nema novih API ruta, OpenAPI i dalje ima 273 putanje; NUL registar nije mijenjan. Ne koristiti završni 11A commit niti tag `phase-11` dok se ostatak i testovi ne završe.

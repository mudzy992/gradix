# ADR 0006 — MinIO: bucket `gradix-v2`, prefiks `gx2/`, usput i Redis prefiks

**Datum:** 2026-11-07 · **Status:** odobreno (vlasnik, odgovor 5)

## Kontekst

v2 smije koristiti postojeću infrastrukturu (MinIO na hostu, Redis na `redis-core`), a v1 ostaje na produkcijskom domenu do posebne odluke. Ako v2 piše u isti bucket ili pod isti prefiks kao v1, dvije aplikacije mogu pregaziti iste objekte, a brisanje ili migracija postaje nerazlučiva.

## Odluka

1. **Bucket:** `gradix-v2` (v1 zadržava `gradix`). Novi bucket, ne dijeljeni.
2. **Prefiks unutar bucketa:** `gx2/` — svaki objekat je `gx2/{companyId}/{yyyy}/{mm}/{uuid}.{ext}`. Prefiks firme ostaje obavezan (tenant izolacija na nivou putanje).
3. **Redis:** prefiks `gx2:` i zaseban ACL korisnik `gradix_v2` (komanda za `redis-cli` je u `infra/redis/acl-v2.txt`, izvršava vlasnik).
4. **Privremeno stanje:** dok bucket ne postoji, v2 ne piše priloge. U R0 priloga nema, pa ovo ništa ne blokira. Bucket se koristi od R5 (gorivo, dnevni pregled mašine).

   **Ažurirano 2026-11-08 (R2b):** prilozi uz obaveze (ljekarski, registracije, licence) uvode
   bucket **ranije nego što je planirano** — R2b ih piše ako su `MINIO_*` postavljeni. Do tada
   (i dok bucket `gradix-v2` ne postoji na serveru) upload se **odbija jasnom porukom**, a obaveza
   se normalno čuva; nema tihe greške ni pisanja u v1 bucket. Putanja priloga prati odluku iz
   PLAN-R2 §5.3: `gx2/{companyId}/obligations/{obligationId}/{attachmentId}` — tenant je u
   putanji, a datum u putanji (`yyyy/mm`) se ne koristi jer prilog pripada obavezi, ne mjesecu.

## Alternative

1. **Zajednički bucket `gradix`** — manje postavljanja, ali miješa vlasništvo i onemogućava čist prelazak i brisanje v1 podataka. Odbačeno.
2. **Zajednički bucket sa prefiksom `gx2/`** — prihvatljivo, ali bucket-level politike (životni ciklus, kvote, backup) onda dijele dvije aplikacije. Odbačeno.
3. **Novi MinIO server** — dodatna infrastruktura bez koristi za jednu firmu. Odbačeno.

## Posljedice

- Postavljanje: kreirati bucket `gradix-v2` i politiku koja dozvoljava pristup samo aplikacijskoj roli v2.
- Potpisani URL-ovi (B6.20) vrijede unutar bucketa; nema javnog listinga.
- Backup mora pokrivati oba bucketa dok je v1 živ.
- Ako se v1 ugasi, bucket `gradix` se arhivira, ne briše odmah.

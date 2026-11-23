# 03 — Radno vrijeme, terenski unos i sync

**Status:** ZAKLJUČANO (vlasnik, 2026-11-23) · **Brief:** B5.6, B10 (offline scenariji), B6.8/6.10 · **Modul:** 3 od 11
**Zavisi od:** Modul 1 (notifikacije, postavke firme), Modul 2 (`canUseEntity`), **Modul 4** (radnik, izostanci/saldo)

Postojeće stanje (ostaje): push ≤100 / pull ≤200×8, `sync_receipts` sa `request_hash`, `sync_change_log` + slotovi bez preskakanja, `sync_conflicts` sa `received_payload`/`payload_hash`/purge, `OPEN → RESOLVED` sa 4 ishoda, `one_open_per_worker`, triger protiv preklapanja, `SUBMITTED → FOREMAN_CONFIRMED → WEEK_APPROVED/WEEK_REJECTED → LOCKED`, append-only revizija sa razlogom ≥10 znakova.

---

## 1. Poslovna pravila

### 1.1 Terenski tok: timer prvog reda
1. Ekran „Moj dan“ je **timer**, ne forma. Jedna velika akcija mijenja stanje: `Počni rad` → `Pauza` → `Nastavi` → `Završi dan`.
2. Ako radnik ima više od jedne dodjele, `Počni rad` traži izbor projekta (i mašine) prije starta; ako ima jednu, ne pita ništa.
3. Sve se upisuje **lokalno u SQLite trenutno**, sinhronizacija u pozadini (postojeći outbox). Nema čekanja mreže u toku rada.
4. Vrijeme se šalje kao UTC + `tz_offset_minutes`; server ostaje pri provjeri plausibilnosti (±5 min, postojeće).
5. Ručni unos ostaje **iza prekidača „Unesi ručno“** (za ured i za ispravke). Nijedno obavezno tekstualno polje u normalnom toku.
6. Dodirne površine ≥ 48 dp; radi u rukavicama; 24 h format (postojeće pravilo `UI-EXCEPTIONS`).

### 1.2 Zaboravljen dan — vidljivo, nikad tiho
7. Prag: `companies.forgotten_day_hours` (12/16/24, **default 16**).
8. Ako je `OPEN` zapis stariji od praga, pri otvaranju ekrana telefon pita: „Jučerašnji dan nije zatvoren — kada si završio?“ sa tri izbora: **unesi vrijeme** / **vrijeme zadnjeg otkucaja** / **„ne znam“**.
9. „Ne znam“ → `end_state='UNKNOWN_END'`, dan ide šefu na **ručnu provjeru** (postojeće stanje, vidljivo u listi).
10. **Otvoren jučerašnji dan ne blokira današnji.** Unique indeks se mijenja: jedan `OPEN` zapis **po radniku po danu** (`work_date = danas`), a stariji otvoreni ostaje vidljiv kao „za provjeru“.
11. Nema tihog auto-zatvaranja (B6.8).

### 1.3 Pauze i vrste dana
12. `work_entries.kind`: `WORK` | `BREAK` (postojeće). Pauza ne nosi projekat ni mašinu (postojeći `CHECK`).
13. **Novo na nivou dana:** `workdays.day_kind` = `WORK` | `VACATION` | `SICK` | `PAID_LEAVE` | `UNPAID_LEAVE` | `HOLIDAY` | `NO_SHOW`.
14. Izostanak se unosi **bez vremena** (jedan klik u grupnom unosu), nosi `absence_note` i **ne ulazi u sate rada**; ulazi u obračun po svom pravilu (Modul 6).
15. Praznik iz `company_holidays` se **predlaže** automatski; rad na praznik je eksplicitno `WORK` i nosi oznaku za dodatak.
16. `NO_SHOW` je samo eksplicitna odluka šefa (nije automatski zaključak iz odsustva unosa).

### 1.4 Sati: zaokruživanje i granice
17. `companies.rounding_minutes` (0/5/10/15/30, **default 0**) + `rounding_mode` (`NEAREST`/`UP`/`DOWN`). Zaokružuje se **po segmentu**, ne po danu.
18. Segmenti se **sijeku po ponoći i po granici sedmice** — dan i sedmica nose tačne sate (B6.6: „nema splita preko ponoći“ je odbačeno).
19. Ovaj modul bilježi **tačno trajanje**. Kategorizacija (redovni/prekovremeni/noćni/praznik/nedjelja) je **Modul 6**, iz parametara firme sa datumom važenja.

### 1.5 Odobravanje
20. Tok ostaje: `SUBMITTED → FOREMAN_CONFIRMED → WEEK_APPROVED | WEEK_REJECTED → LOCKED`; zaključano se mijenja samo revizijom sa razlogom (postojeće).
21. **Grupna potvrda:** šef potvrđuje sve dane svoje ekipe za **projekt + datum** jednim klikom; pojedinačna potvrda ostaje za izuzetke.
22. **Sedmični pregled** je obavezan prije odluke o sedmici: tabela radnik × dan (sati, `day_kind`, status), sume po radniku i po projektu, CSV preuzimanje.
23. `WEEK_REJECT` vraća sve dane sedmice sa razlogom; šef vidi tačno koje dane treba ispraviti.
24. Šef ne potvrđuje vlastiti dan; niko ne odobrava svoj obračun (postojeće pravilo se zadržava).

### 1.6 Upozorenja umjesto tihih blokada (B5.6)
25. Rad na projektu bez važeće dodjele → **žuto upozorenje** + polje `assignment_warning` u zapisu; **ne blokira** (šef zna bolje od baze).
26. Zapis > 16 h bez pauze → upozorenje pri snimanju.
27. Preklapanje → triger hvata, ali poruka je ljudska („Imaš zapis 07:00–16:00; novi počinje u 15:00“), nikad 500.
28. `canUseEntity` (Modul 2) pri prijavi dana: **samo crvena traka**, nikad blokada.

### 1.7 Sync
29. `sync_conflicts` se proširuje sa `work_entry_id` na **`entity_type` + `entity_id`** za sve terenske entitete: `workday`, `work_entry`, `machine_work_log`, `fuel_entry`, `haul`, `machine_daily_check`, `machine_fault`.
30. Radnik na telefonu vidi ishod: „Poslano — ured provjerava“ → „Prihvaćeno“ / „Ispravljeno“ / „Odbijeno“ (postojeći `r4-resolution`).
31. **Novo:** kad ured razriješi sukob, radnik dobija **in-app/push obavještenje** (Modul 1 inbox) — ne mora otvarati aplikaciju.
32. `sync_receipts` i `sync_conflicts` se čiste po `companies.sync_conflict_retention_days` (postojeće, default 90) — job u workeru (danas ga nema ko pokrenuti).
33. Na Pregledu: broj konflikata po firmi/sedmici (vlasnik vidi da li teren ima problem sa mrežom).
34. Replay zaštita ostaje kakva jeste — **ne** vraćati složenost iz v1 (B6.16).

---

## 2. Promjene na bazi

| Objekat | Promjena |
|---|---|
| `workdays` | `+ day_kind TEXT NOT NULL DEFAULT 'WORK' CHECK (...)`, `+ absence_note`, `+ assignment_warning BOOLEAN NOT NULL DEFAULT false` |
| `work_entries` | `+ tz_offset_minutes SMALLINT` (informativno, istina je UTC), `+ segment_source ('TIMER'\|'MANUAL'\|'SYNC')` |
| unique indeks `work_entries_one_open_per_worker` | zamijenjen sa `(company_id, worker_id, work_date)` gdje je `end_state='OPEN'` — jučerašnji otvoren dan ne blokira današnji |
| `sync_conflicts` | `+ entity_type TEXT NOT NULL`, `entity_id TEXT`; `work_entry_id` ostaje nullable (kompatibilnost) |
| `work_week_approvals` | `+ reviewed_snapshot JSONB` (sume koje je vlasnik vidio pri odluci) |
| `companies` | `+ forgotten_day_hours SMALLINT DEFAULT 16`, `+ rounding_minutes SMALLINT DEFAULT 0`, `+ rounding_mode TEXT DEFAULT 'NEAREST'` (dio Modula 1, konzumira se ovdje) |

Nove tabele: nema (izostanci su `day_kind`, saldo godišnjeg je Modul 4).

---

## 3. API ugovor

| Metoda | Ruta | Dozvola | Napomena |
|---|---|---|---|
| POST | `/api/workdays/start` · `/pause` · `/resume` · `/finish` | authenticated (vlastiti) | timer; idempotentno po `localId` |
| POST | `/api/workdays/close-forgotten` | authenticated | `{ kind: 'TIME'\|'LAST_PING'\|'UNKNOWN', endedAt? }` |
| GET | `/api/workdays/week?weekStart=` | `workdays.view` | radnik × dan + sume |
| POST | `/api/workdays/confirm-bulk` | `workdays.confirm` | `{ projectId, workDate }` |
| GET | `/api/workdays/week/export` | `workdays.view` | CSV prije odluke |
| PATCH | `/api/workdays/:id/kind` | `workdays.revise` | `day_kind`, uz razlog |
| GET | `/api/me/blockers` | authenticated | Modul 2 |

Postojeće rute ostaju (`confirm`, `revise`, `decide`, `lock`, `conflicts/resolve`, `work-weeks/*`). Novi kodovi: `WORKDAY_ALREADY_OPEN`, `WORKDAY_FORGOTTEN`, `WORKDAY_NOT_ASSIGNED` (upozorenje, ne greška).

---

## 4. UI / UX

| Ekran | Sadržaj |
|---|---|
| Mobilni „Moj dan“ | veliki timer + stanje tekućeg segmenta (projekat/mašina), dugmad Počni/Pauza/Nastavi/Završi, ukupno danas; prekidač „Unesi ručno“ |
| Mobilni „Zaboravljen dan“ | modal sa tri izbora (§1.2) |
| Mobilni „Grupa“ | lista ekipe sa checkbox-om + izbor `day_kind` (izostanak jednim klikom) |
| `/ured/radni-dani` | po danu, sa `day_kind` chipom i „za provjeru“ |
| `/ured/radni-dani/sedmica` | tabela radnik × dan, sume, CSV, approve/reject sa snimkom |
| `/ured/sukobi` | postojeće + filter po `entity_type` |

---

## 5. Testovi

1. Timer: start→pause→resume→finish daje tačan zbir segmenata; dvostruki start odbija se sa `WORKDAY_ALREADY_OPEN`.
2. Zaboravljen dan: stariji `OPEN` ne blokira novi dan; `UNKNOWN_END` ide u „za provjeru“.
3. `day_kind`: izostanak ne ulazi u sate rada; praznik se predlaže; rad na praznik je `WORK`.
4. Zaokruživanje: po segmentu, sva tri moda; granični slučaj 7,5 min → 0/15.
5. Ponoć: segment 22:00–02:00 dijeli se na dva dana i dvije sedmice tačno.
6. Grupna potvrda: potvrđuje samo ekipu na projektu za datum; tuđi dan nije diran.
7. Sedmica: `reviewed_snapshot` odgovara sumama u trenutku odluke; odbijena sedmica vraća sve dane.
8. Konflikt: po svakom od 7 `entity_type`; ishod se vidi na telefonu i šalje obavještenje.
9. Offline: prekid mreže tokom push-a ne gubi zapis; ponovni push je idempotentan.
10. Izolacija: firma B ne vidi dane, sukobe ni potvrde firme A.

Van opsega: GPS prisustvo (B15, model samo ne smije blokirati) · biometrija · geofence.

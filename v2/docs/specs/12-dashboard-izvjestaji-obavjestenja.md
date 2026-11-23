# 12 — Dashboard, izvještaji, mobilna aplikacija i obavještenja

**Status:** ZAKLJUČANO (vlasnik, 2026-11-23) · **Brief:** B5.12, B5.13, B5.14, B15.16 · **Modul:** 12 od 12
**Zavisi od:** svi moduli 1–11 (dashboard i izvještaji čitaju njihove servise, nikad paralelno sabiranje)

Postojeće stanje: `/pregled` (`pregled-board.tsx` — redoslijed po hitnosti, svaki red vodi na ekran rješenja: `expired`, `conflicts`, `expiring30`, `reviewDays`, `blockedAssignments`, `expiring3190`), `dashboard-aggregates.ts` (`activeProjects`, `bookedCosts`, `hoursInPeriod` — jedan period, bez role), `hours-export` (CSV), lista troškova projekta, `apps/mobile` (Expo, 9 ekrana, offline sync za 7 entiteta), 82 API rute, 11 Maestro tokova.

**Dijagnoza:** pregled je najbolji ekran u sistemu, ali prikazuje samo rokove i sukobe; nema novčanih ni HSE signala, nema razlike po roli, nema nijednog izvještaja, i — najvažnije — **nema mehanizma da sistem nekoga probudi**. Bez obavještenja evidencija ostaje evidencija, ne upravljanje.

---

## 1. Poslovna pravila

### 1.1 Dashboard po roli
1. Zajednička osnova: **lista akcija**, sortirana po hitnosti, svaka vodi na ekran rješenja. Nema „ukupno“ kartica koje ne traže akciju.
2. **OWNER:** rizični projekti (negativna marža / prekoračen budžet), novac u toku (nabavka, podizvođači, garancije koje ističu), istekli rokovi firme, HSE `PROHIBITION`, top 3 mašine po trošku/h.
3. **PROJECT_MANAGER:** moji projekti (budžet vs stvarno, % završenosti), zadaci koji kasne, tenderski rokovi u 14 dana, dani bez potvrde.
4. **SITE_SUPERVISOR:** danas — ekipa koja radi, mašine na projektu, otvoreni problemi/zadaci, HSE mjere koje kasne, dnevnik bez potpisa.
5. **ACCOUNTANT:** periodi spremni za obračun, troškovi za odobrenje, računi u neslaganju, `PENDING` troškovi, satnice koje nedostaju.
6. **MECHANIC:** moji nalozi, „čekaju dijelove“, preventivni servisi koji istječu.
7. **Nula = skriveno.** Prazna tabla nije informacija; ako nema akcija, prikazuje se „Sve pod kontrolom“ sa datumom zadnje provjere.

### 1.2 Obavještenja
8. `notifications`: `user_id NULL`, `role_target NULL`, `kind`, `title`, `body`, **`href` obavezan**, `severity` (`INFO|WARN|CRITICAL`), `source_type`, `source_id`, `dedupe_key`, `created_at`, `read_at`, `actioned_at`.
9. **`dedupe_key`** = jedno obavještenje po stvari (`budget:project:rev2:80`, `obligation:<id>:7`), ne na svaki prolaz posla.
10. Kanali (`notification_preferences`, događaj × kanal): **in-app obavezan i ne može se isključiti**; push (Expo) i email (SMTP adapter, Modul 1) po izboru.
11. Ako email nije konfigurisan (`BLOCKED_NO_PROVIDER`), poruka **ostaje u inboxu** — ne nestaje i ne pravi se tiho.
12. Retencija: pročitana **90 dana**, nepročitana **1 godina**, `CRITICAL` **2 godine**.

### 1.3 Posao u pozadini (`apps/worker`)
13. `apps/worker` (Node + **`pg-boss`** na Postgresu, bez Redisa — Modul 1) sa šest poslova:
    - `reminders.scan` (15 min): obaveze (2), preventivni servis (9), HSE mjere (10), garancije (8), tenderski rokovi (8);
    - `budget.thresholds` (na knjiženje + noćno): pragovi 80/100% (6);
    - `attachments.purge` (noćno): prilozi po retenciji (1/2);
    - `sync.purge` (noćno): istorija sukoba i receipts (3);
    - `rollup.nightly`: dnevni agregati (projekat × dan: trošak, sati) za brze izvještaje;
    - `reports.scheduled`: mjesečni PDF (opciono po firmi).
14. Svaki posao je **idempotentan** (`dedupe_key`/`source_id`); pad se ponavlja bez dupliranja.
15. `/api/health` prošireno stanjem reda (broj zaglavljenih poslova) — vidljivo u `/ured/postavke`.

### 1.4 Izvještaji: sedam definicija, jedan motor
16. `report-service` sa definicijama kao **podacima**, ne sedam servisa: trošak po projektu (6), iskorištenost i trošak mašina (5), potrošnja goriva (5), radni sati po radniku/projektu (3/7), rokovi i isteci (2), tenderi (8), HSE (10).
17. Svaki izvještaj: filteri (period, projekat, tim), **PDF** i **XLSX**, `generated_by` + `generated_at` u podnožju.
18. **Jedan izvor brojeva:** izvještaji čitaju iste servise/upite kao ekrani, nikad paralelno sabiranje (pravilo iz Modula 6).
19. Zakazani mjesečni izvještaj emailom je **opcija po firmi**, ne default.

### 1.5 Globalna pretraga
20. `/api/search?q=` po: radnici, mašine, projekti, partneri, tenderi, obaveze, zadaci, servisni nalozi, incidenti.
21. **Server-side, RLS-om ograničeno** na opseg korisnika; rezultat nosi tip, naslov i `href`.
22. Tastatura `Cmd/Ctrl+K`, strelice, `Enter`; na mobilnom polje u zaglavlju.
23. `pg_trgm` + indeksi; **bez vektorske pretrage** u MVP-u.

### 1.6 Izvozi iz listi
24. Svaka lista dobija izvoz (Excel/CSV) sa **istim filterima** kao ekran.
25. Dozvola `export.data` (OWNER/ADMIN/PM/ACCOUNTANT); osjetljiva polja (Modul 4) i satnice se **ne izvoze** bez `workers.sensitive.view` / `workers.rates.view`.
26. Veliki izvozi idu kroz `apps/worker` (posao + obavještenje sa linkom), ne kroz sinhroni HTTP.

### 1.7 Mobilna aplikacija
27. Dodaje se: obavještenja (inbox + push), zadaci (6), dnevnik (10), HSE prijava i toolbox (10), servisni nalozi (9), „moj obračun“ (7), izlaz materijala (11).
28. **Uređaji i sesije:** lista uređaja po korisniku (web `/ured/postavke/sesije`, mobilno „moji uređaji“), **odjava na daljinu** (Modul 1), obavezna ponovna prijava poslije odjave.
29. **Indikator sinhronizacije** ostaje na telefonu; u uredu se dodaje izvještaj po korisniku („3 zapisa čekaju, zadnji sync prije 6 h“) — za podršku, ne za nadzor.
30. iOS ostaje `[OTVORENO]`; Android prioritet, distribucija internim buildom od prvog reza.

### 1.8 Kvalitet podataka
31. `data_health` panel na `/pregled` (OWNER/ADMIN): dani bez potvrde, projekti bez budžeta, mašine bez stope, radnici bez satnice, skladišta bez minimuma, incidenti bez mjera.
32. Svaka stavka vodi na listu sa filterom — **onboarding u praksi**: sistem kaže šta mu fali.

---

## 2. Promjene na bazi

| Objekat | Promjena |
|---|---|
| `notifications` (novo) | vidi §1.2/8; indeks `(company_id, user_id, read_at)`, `dedupe_key` unique po `(company_id, dedupe_key)` |
| `notification_preferences` (novo) | `user_id, kind, in_app (uvijek true), push, email`, unique `(company_id, user_id, kind)` |
| `notification_deliveries` (novo) | `notification_id, channel, status ('PENDING'|'SENT'|'FAILED'|'BLOCKED_NO_PROVIDER'), attempts, last_error, sent_at` |
| `report_jobs` (novo) | `id, company_id, report_key, params JSONB, format, status, result_object_key, requested_by, created_at, finished_at` |
| `daily_rollups` (novo) | `company_id, project_id, day, cost_cents, hours, machine_hours, ...`, unique `(company_id, project_id, day)` |
| `user_devices` (novo) | `id, company_id, user_id, platform, device_name, push_token, last_seen_at, revoked_at` |
| `companies` | `+ monthly_report_enabled BOOLEAN DEFAULT false`, `+ monthly_report_recipients TEXT[] NULL` |

Sve nove tenant tabele: `FORCE RLS` + politika + `privilege-matrix.tsv` + preflight. `pg_trgm` ekstenzija + GIN indeksi na `workers`, `machines`, `projects`, `partners`, `tenders`.

---

## 3. API ugovor

| Metoda | Ruta | Dozvola |
|---|---|---|
| GET | `/api/dashboard` (po roli, akcione kartice) | `dashboard.view` |
| GET | `/api/notifications` (+`?unread`) | `authenticated` |
| POST | `/api/notifications/:id/read` / `/read-all` | `authenticated` |
| GET/PUT | `/api/notification-preferences` | `authenticated` |
| GET/POST | `/api/users/me/devices` (+`/:id/revoke`) | `authenticated` |
| GET | `/api/reports/:key?format=pdf\|xlsx&…` | `reports.view` |
| GET/POST | `/api/report-jobs` (+`/:id`) | `reports.view` |
| GET | `/api/search?q=` | `authenticated` |
| GET | `/api/data-health` | `dashboard.view` |
| GET | `/api/health` (prošireno: stanje reda) | javno (bez detalja tenanta) |

Nove dozvole: `reports.view` (OWNER/ADMIN/PM/ACCOUNTANT), `export.data` (OWNER/ADMIN/PM/ACCOUNTANT).
Novi kodovi: `REPORT_JOB_FAILED`, `EXPORT_FORBIDDEN_FIELD`, `PUSH_TOKEN_INVALID`, `NOTIFICATION_PROVIDER_BLOCKED`.

---

## 4. UI / UX

| Ekran | Sadržaj |
|---|---|
| `/pregled` | dashboard po roli (akcione kartice) + `data_health` panel za OWNER/ADMIN |
| `/obavjestenja` | inbox: nepročitano prvo, filter po tipu, „označi sve“, direktan `href` |
| `/ured/postavke/obavjestenja` | matrica događaj × kanal (in-app zaključan na uključeno) |
| `/ured/postavke/sesije` | uređaji i sesije po korisniku, odjava na daljinu |
| `/ured/izvjestaji` | sedam izvještaja, filteri, PDF/XLSX, „zakaži mjesečno“ |
| `/ured/izvjestaji/poslovi` | status izvoznih poslova, preuzimanje gotovih |
| globalna pretraga | `Cmd/Ctrl+K` overlay, grupisani rezultati po tipu |
| mobilno `/obavjestenja` | inbox + push; klik vodi na ekran |
| mobilno `/zadaci`, `/dnevnik`, `/hse`, `/servis`, `/moj-obracun`, `/izlaz` | novi ekrani po roli |
| mobilno `/moji-uredjaji` | uređaji, odjava na daljinu za sve ostale |

---

## 5. Testovi

1. Dashboard: svaka rola dobija svoj skup kartica; kartica sa nulom skrivena; svaka kartica ima `href`.
2. Obavještenja: `dedupe_key` sprječava duplikat; `href` obavezan; in-app se ne može isključiti; email bez providera → `BLOCKED_NO_PROVIDER` i poruka ostaje u inboxu.
3. Worker: svaki posao idempotentan (dva prolaza = jedno obavještenje); pad se ponavlja; `/api/health` prikazuje zaglavljene poslove.
4. Retencija: pročitana 90 dana, nepročitana 1 g, `CRITICAL` 2 g — purga briše tačno po pravilu.
5. Izvještaji: sedam izvještaja generišu PDF i XLSX; brojevi identični ekranu za isti period (jedan izvor).
6. Pretraga: RLS — PM ne nalazi tuđe projekte; `Cmd+K` vraća rezultate sa `href`; bez vektorskog sloja.
7. Izvoz: filteri ekrana se prenose; satnice i osjetljiva polja nisu u izvozu bez dozvole; veliki izvoz ide kroz worker.
8. Mobilno: push token registrovan, odjava na daljinu obara sesiju, sinhronizacija prikazuje tačan broj zapisa.
9. `data_health`: svaka stavka odgovara stvarnom stanju i vodi na filtriranu listu.
10. Izolacija: firma B ne vidi obavještenja, izvještaje, uređaje firme A.

Van opsega: AI/vektorska pretraga, kvalifikovani elektronski potpis, iOS distribucija, integracije trećih strana preko javnog API-ja (B15), webhook-ovi.

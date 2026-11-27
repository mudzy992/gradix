# 04 — Radnici (kadrovska evidencija)

**Status:** ZAKLJUČANO (vlasnik, 2026-11-23) · **Brief:** B5.5, B5.7 (ulazni podaci), B7 (privatnost) · **Modul:** 4 od 11
**Zavisi od:** Modul 1 (`attachment-service`, `ACCESS` audit, retencija, dozvole), Modul 2 (rokovi, `canUseEntity`), Modul 3 (`day_kind` za saldo)

Postojeće stanje (ostaje): `workers` sa `first/last_name, phone, email, job_title, engagement, hired_at, ended_at, team, supervisor_id, user_id, is_active`; `createWorker/updateWorker/setWorkerActive/linkWorkerUser`; uvoz iz Excela sa pravilom „nema sigurnog ključa → duplikat se prijavljuje, ne spaja se tiho“; veza na nalog traži `users.manage`.

---

## 1. Poslovna pravila

### 1.1 Profil
1. Radnik ≠ korisnik. `user_id` je opciona veza; radnik bez naloga je uobičajen slučaj (postojeće).
2. **Novo polja:** `middle_name`, `birth_date`, `address`, `education_level` (`NK/KV/SSS/VŠS/VSS`), `profession` (zanimanje po šifarniku), `driving_categories TEXT[]` (`B,C,CE,D,…`), `blood_type`, `shoe_size`, `clothing_size`, `emergency_contact_name`, `emergency_contact_phone`, `photo_object_key`, `notes`.
3. **Nema JMBG-a i nema bankovnog računa** — odluka vlasnika ostaje. Model ih ne predviđa.
4. Osjetljiva polja (`birth_date`, `address`, `blood_type`, `emergency_contact_*`) čita samo `workers.sensitive.view` (OWNER, ADMIN); svako čitanje upisuje `ACCESS` audit (Modul 1 §42).
5. Veličine (`shoe_size`, `clothing_size`) nisu osjetljive — potrebne su šefu i skladištu za OZO.
6. Fotografija ide kroz `attachment-service` (kompresija, max 5 MB, `image/*`), nije osjetljiva.

### 1.2 Novac: istorija, nikad prepisivanje
7. `worker_rates`: `rate_kind` = `HOURLY` | `MONTHLY` | `DAILY` | `COEFFICIENT`, `amount_cents` + `currency_code`, `coefficient`, `valid_from`, `valid_to`.
8. Nova stopa = **novi red**; stari dobija `valid_to`. Nijedan `UPDATE` na iznos postojećeg reda se ne dopušta (dozvoljen je samo `valid_to`).
9. Obračun (Modul 6) uzima stopu **koja je važila na dan rada**, nikad trenutnu (B5.7).
10. Vidljivost: `workers.rates.view` = OWNER, ADMIN, ACCOUNTANT. **PM i šef gradilišta ne vide satnice.** Promjena: `workers.rates.manage` = OWNER, ADMIN. Svaka izmjena u auditu i u `worker_history`.

### 1.3 Izostanci i godišnji
11. `worker_leave_entitlements (worker_id, year, days_entitled, days_carryover, note)` — pravo po godini, unosi ured.
12. Konzumacija se **ne unosi duplo**: saldo = `days_entitled + days_carryover − broj dana sa day_kind='VACATION'` iz Modula 3.
13. `SICK` ne troši godišnji. `PAID_LEAVE`/`UNPAID_LEAVE` imaju svoja pravila u obračunu (Modul 6).
14. Saldo se prikazuje sa progresom i listom datuma iskorištenja; negativan saldo je dopušten uz vidljivo upozorenje (realnost: unaprijed uzet godišnji).
15. Prenos u narednu godinu (`days_carryover`) unosi ured; nema automatskog prenosa (zakon i pravilnik firme se razlikuju).

### 1.4 Zaduženja (OZO, alat, uređaj)
16. `worker_issuances`: `item_kind` (`PPE`|`TOOL`|`DEVICE`|`OTHER`), `item_name`, `size`, `serial_no`, `quantity`, `issued_at`, `returned_at`, `condition` (`NEW`|`USED`|`DAMAGED`), `issued_by`, `returned_to`, `stock_item_id` (nullable — veza na skladište u Modulu 10).
17. Zaduženje se **ne briše**; povrat upisuje `returned_at` + stanje. Greška u unosu se ispravlja novim redom + razlogom.
18. „Ko šta ima kod sebe“ = `returned_at IS NULL`.
19. **OZO šabloni po radnom mjestu** (`ppe_templates`): „bagerista“ → kaciga, prsluk, čizme, rukavice. Jedan klik izdaje cijeli set, pojedinačno se dopunjava.
20. Zaduženja sa `returned_at IS NULL` blokiraju zatvaranje radnika (§1.6) — upozorenje, ne tvrda blokada (vlasnik može odlučiti drugačije uz razlog).

### 1.5 Kvalifikacije — dvije stvari, bez duplikata
21. **Rokovi** (ljekarski, ovlaštenje za mašinu, vozačka dozvola kao dokument) ostaju u **Modulu 2** (`obligations`). Nijedno polje se ne duplira.
22. **Trajne osobine** (stručna sprema, zanimanje, vozačke kategorije) su polja radnika.
23. `driving_categories` ulazi u `canUseEntity` za akciju `drive_vehicle` (tura kamionom traži `C`/`CE`): **upozorenje**, ne blokada — dokument (vozačka) je u Modulu 2 i on blokira kad istekne.

### 1.6 Odlazak radnika (`ended_at` postavljen)
24. Jedan dijalog „Radnik odlazi“ pokreće, u jednoj transakciji:
    a) deaktivacija radnika i svih aktivnih `project_assignments` (§ datum prestanka),
    b) opoziv naloga (`users.is_active=false`, `memberships.is_active=false`) i **svih sesija**,
    c) lista aktivnih zaduženja za povrat (`returned_at IS NULL`) — dijalog ne prolazi dok se ne potvrde ili eksplicitno označe „otpisano uz razlog“,
    d) otvaranje rokova za povrat opreme i brisanje budućih obaveza koje više nemaju smisla (npr. servis koji je vezan na radnika),
    e) pokretanje retencije osjetljivih priloga (24 mj., Modul 2 §31),
    f) audit + `worker_history`.
25. Radnik se **nikad ne briše**. Reaktivacija je dopuštena (povratak) i vraća nalog u ručnu aktivaciju (ne automatski).
26. Odgovornost za rokove: `supervisor_id` je **default odgovorni** za rokove svojih radnika, ako obaveza nema eksplicitnog `responsible_user_id` (Modul 2 §22).

### 1.7 Povijest
27. `worker_history (field, old_value, new_value, changed_at, changed_by, reason)` — upisuje servis u istoj transakciji za: `engagement`, `team`, `supervisor_id`, `job_title`, `education_level`, `is_active`, `ended_at`, te sve `worker_rates` promjene.
28. `audit_events` ostaje za „ko/šta/kada“; `worker_history` je čitljiva vremenska linija na kartici radnika. Dvoslojno namjerno: audit je pravni trag, historia je UX.

### 1.8 Masovne izmjene
29. Tri akcije: **premjesti u ekipu**, **promijeni nadređenog**, **nova satnica za grupu** — jedan dijalog, N radnika, jedna transakcija.
30. Izvještaj preskočenih sa razlogom (npr. radnik nije aktivan, `hired_at` poslije `valid_from`). Djelimično izvršenje nije dopušteno.

---

## 2. Promjene na bazi

| Tabela | Sadržaj |
|---|---|
| `workers` (proširenje) | `middle_name, birth_date, address, education_level, profession, driving_categories TEXT[], blood_type, shoe_size, clothing_size, emergency_contact_name, emergency_contact_phone, photo_object_key, notes` |
| `worker_rates` (novo) | `id, company_id, worker_id, rate_kind, amount_cents, currency_code, coefficient, valid_from, valid_to, note, created_by, created_at`; `CHECK (valid_to IS NULL OR valid_to >= valid_from)`; zabrana preklapanja istog `rate_kind` (EXCLUDE ili triger, kao kod dodjela) |
| `worker_leave_entitlements` (novo) | `id, company_id, worker_id, year SMALLINT, days_entitled NUMERIC(5,1), days_carryover NUMERIC(5,1) DEFAULT 0, note`, unique `(company_id, worker_id, year)` |
| `worker_issuances` (novo) | `id, company_id, worker_id, item_kind, item_name, size, serial_no, quantity, issued_at, returned_at, condition, note, issued_by, returned_to, stock_item_id NULL` |
| `ppe_templates` (novo) | `id, company_id, job_title, items JSONB` (naziv, količina, veličina-obavezna bool) |
| `worker_history` (novo) | `id, company_id, worker_id, field, old_value, new_value, changed_at, changed_by, reason` |

Sve tenant tabele: `ENABLE`/`FORCE RLS`, politika po `company_id`, unos u `privilege-matrix.tsv` + preflight. `photo_object_key` ide u bucket kroz `attachment-service`.

---

## 3. API ugovor

| Metoda | Ruta | Dozvola |
|---|---|---|
| GET/POST/PATCH | `/api/workers` (+`/:id`) | `workers.view` / `workers.manage` |
| GET | `/api/workers/:id` (puna kartica) | `workers.view` (+ `workers.sensitive.view` za osjetljiva polja) |
| GET/POST/PATCH | `/api/workers/:id/rates` (+`/:rateId/close`) | `workers.rates.view` / `workers.rates.manage` |
| GET/POST | `/api/workers/:id/leave` (+`/entitlement`) | `workers.leave.view` / `workers.leave.manage` |
| GET/POST/PATCH | `/api/workers/:id/issuances` (+`/:id/return`) | `workers.issuances.view` / `workers.issuances.manage` |
| POST | `/api/workers/:id/offboard` | `workers.manage` (dijalog §1.6) |
| GET/POST/PATCH/DELETE | `/api/ppe-templates` | `workers.issuances.manage` |
| POST | `/api/workers/bulk` (`changeTeam`\|`changeSupervisor`\|`newRate`) | `workers.manage` / `workers.rates.manage` |
| GET | `/api/workers/:id/history` | `workers.view` |
| POST | `/api/workers/:id/photo` | `workers.manage` |

Nove dozvole: `workers.sensitive.view`, `workers.rates.view`, `workers.rates.manage`, `workers.leave.view`, `workers.leave.manage`, `workers.issuances.view`, `workers.issuances.manage`.
Novi kodovi: `WORKER_SENSITIVE_FORBIDDEN`, `WORKER_HAS_ACTIVE_ISSUANCES`, `RATE_OVERLAP`.

---

## 4. UI / UX

| Ekran | Sadržaj |
|---|---|
| `/ured/radnici` | lista sa filterima (ekipa, angažman, aktivan, „ima istekle rokove“), masovne akcije |
| `/ured/radnici/[id]` — **Kartica radnika** | **Profil** (osnovno, kontakt, OZO veličine, hitni kontakt — sakriveno bez dozvole) · **Rokovi** (aktivne + `missing`) · **Rad** (30 dana, saldo godišnjeg, sati po projektu) · **Zaduženja** (aktivna + historija) · **Novac** (samo dozvoljene role) · **Vremenska linija** |
| `/ured/radnici/[id]/zaduzenja` | izdavanje, povrat, OZO set jednim klikom |
| `/ured/radnici/odlazak` | dijalog §1.6 sa kontrolnom listom |
| `/ured/postavke/ozo-sabloni` | šabloni po radnom mjestu |
| Mobilni | kartica radnika bez novca i bez osjetljivih polja; fotografija u listi ekipe |

---

## 5. Testovi

1. Osjetljiva polja: bez `workers.sensitive.view` nema ih u odgovoru; čitanje upisuje `ACCESS` audit.
2. Satnice: PM/šef dobijaju 403; nova stopa zatvara staru, ne prepisuje; preklapanje perioda se odbija.
3. Obračun uzima stopu na dan rada (test sa promjenom u toku mjeseca).
4. Godišnji: saldo = pravo + prenos − `VACATION` dani; `SICK` ne troši.
5. Zaduženja: povrat upisuje stanje; otuđeno se ne briše; `stock_item_id` nullable.
6. Odlazak: opoziva sesije, deaktivira dodjele, traži povrat zaduženja, pokreće retenciju — sve ili ništa.
7. Odgovornost: obaveza radnika bez `responsible_user_id` dobija nadređenog; eksplicitni odgovorni pobjeđuje.
8. Masovne izmjene: jedna greška → 0 izmjena.
9. `driving_categories` daje upozorenje u `canUseEntity`, ne blokadu.
10. Izolacija: firma B ne vidi radnike, satnice, zaduženja ni povijest firme A.

Van opsega: regrutacija, ugovori o radu kao dokumenti (Modul 9), obračun plaća (Modul 6), evidencija radnog vremena (Modul 3).

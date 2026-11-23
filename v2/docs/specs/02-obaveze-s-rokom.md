# 02 — Obaveze s rokom

**Status:** ZAKLJUČANO (vlasnik, 2026-11-23) · **Brief:** B5.4, B5.8 (rokovi mašina), B7 · **Modul:** 2 od 11
**Zavisi od:** Modul 1 (`apps/worker`, notifikacije §47–50, audit `ACCESS`/retencija §41–42)

Postojeće stanje (ostaje, ne mijenja se): polimorfna veza kroz nullable FK + `CHECK` tačno-jedan-entitet, kompozitni FK `(company_id, x_id)`, verzije + trigger keš, `obligation_state()` u SQL-u i domeni sa testom jednakosti, `SELF` opseg prije filtera, posebna dozvola za priloge, brisanje samo u prvih 24 h.

---

## 1. Poslovna pravila

### 1.1 Stanja (proširenje sa 4 na 7 izračunatih + 2 ručna)
1. **Izračunata iz datuma** (ostaje): `valid`, `expiring`, `expired`, `no_expiry`, `superseded`.
2. **Novo — `missing`:** tip je obavezan za entitet (`obligation_requirements`), a aktivne obaveze tog tipa nema. **Nije red u `obligations`** — računa se upitom (`entiteti MINUS aktivne obaveze tog tipa`), pa ne nastaju „duhovi“ kad se radnik obriše/deaktivira.
3. **Novo — `pending_review`:** dokument uploadovan, čeka potvrdu ureda. Nastaje samo ako `obligation_types.requires_review = true` (default `false`).
4. **Novo — `rejected`:** ured odbio dokument uz obavezan razlog; prilog ostaje u historiji, obaveza se vraća na doradu.
5. Prioritet prikaza: `missing` > `expired` > `pending_review` > `expiring` > `valid` > `no_expiry` > `superseded`.
6. Dan isteka **nije** istekao (postojeće pravilo ostaje).
7. `no_expiry` (trajno) dobija `review_at` — datum do kojeg ured mora ručno potvrditi da dokument još važi. Bez `review_at` trajna obaveza **ne postoji** (polje je obavezno kad `expires_at IS NULL`).
8. `missing` **ne blokira** dodjelu (nema dokumenta ≠ istekao dokument) — ali je prvi red na Pregledu i u listi rokova. Blokiraju samo `expired` i `rejected`.

### 1.2 Zahtjevi (obligation_requirements)
9. Firma definiše pravilo: „svaki radnik mora imati X“ / „svaka mašina kategorije K mora imati Y“ / „svaki projekat mora imati Z“.
10. Pravilo nosi: `entity_kind`, `type_id`, opseg primjene (`ALL` ili `ENGAGEMENT` ili `MACHINE_CATEGORY` ili `PROJECT`), `is_required`.
11. Iz pravila se **ne** generišu redovi automatski; `missing` se računa. Akcija **„Kreiraj sve nedostajuće“** formira prazne obaveze (bez datuma, stanje `missing` dok se ne popune) u jednoj transakciji, sa izvještajem koliko je kreirano/preskočeno.
12. Deaktivacija entiteta (radnik/mašina) izbacuje ga iz `missing` računa — mrtvi ljudi ne prave lažne obaveze.
13. `obligation_types.sensitive` (medicinski, vozačka) određuje: posebnu dozvolu za prilog, `ACCESS` audit pri čitanju i retenciju.

### 1.3 Jedan motor blokada: `canUseEntity`
14. Jedna funkcija u `@gradix/domain`, jedan ugovor za web, mobilni i sve module:
    `canUseEntity({ entity, entityId, action }) → { allowed, blockers[], overrideAvailable }`.
15. **Akcije i ponašanje:**

| Akcija | Blokira? | Blokirajuća stanja |
|---|---|---|
| `assign` (radnik na projekat) | DA (postojeće) | `expired`, `rejected` |
| `assign` (mašina na projekat) | **DA (novo)** | `expired`, `rejected` |
| `haul` (tura) | **DA (novo)** | `expired`, `rejected` |
| `machine_hours` (radni sati mašine) | **DA (novo)** | `expired`, `rejected` |
| `fuel` (točenje) | **NE — samo jako crveno upozorenje** | — |
| `workday` (prijava dana, mobilni) | **NE — samo crvena traka** | — |
| `tender_submit` (predaja tendera) | **DA (novo)** | `expired`, `rejected` (ponudbena garancija, kvalifikacije) |

16. **Zašto gorivo ne blokira:** mašina stoji na pumpi ili gradilištu; ako se točenje ne evidentira, trošak i litraža ostaju „u zraku“ i knjigovodstvo gubi trag. Nesklad između evidencije i stvarnosti je gori od neuredne administracije.
17. **Zašto radni dan ne blokira:** radnik ne smije ostati bez evidentiranog dana zbog dokumenta koji ured nije obnovio. Gubi se osnov za obračun.
18. `pending_review` i `missing` **nikad** ne blokiraju; prikazuju se kao upozorenje.
19. Iznimka (postojeći tok, ADR 0010) se proširuje: `project_assignment_overrides` postaje **`usage_overrides`** sa `subject_kind` (`WORKER`/`MACHINE`/`TENDER`) i `subject_id`, `reason` (≥10 znakova), `valid_from/valid_to`, `approved_by`. PM traži, OWNER/ADMIN odobrava. Blokada se pušta samo uz važeću iznimku za **taj** subjekt i **tu** radnju; iznimka je u auditu i vidljiva na kartici entiteta.
20. **Blokada je uvijek ista funkcija na serveru.** Mobilni dobija `GET /api/me/blockers` (radnik + mašine koje smije koristiti) i ne može zaobići pravilo; UI samo prikazuje ono što server vraća.

### 1.4 Podsjetnici i eskalacija
21. Pragovi: `obligations.reminder_days INT[]` (nullable) — ako je `NULL`, koristi se `obligation_types.default_reminder_days`.
22. Primao ci: `obligations.responsible_user_id` **+** `obligation_notify_roles` po tipu (npr. `MEDICAL` → šef gradilišta + ured + radnik lično; `REGISTRATION` → ured + vozač mašine). Radnik uvijek dobija svoj rok (postojeće pravilo `SELF`).
23. Dnevni prolaz u workeru, **06:00 u zoni firme**: za svaku firmu nađi obaveze gdje `daysLeft ∈ reminder_days` → `notifications` sa `dedupe_key = "{obligationId}:{daysLeft}"`. Ponovni prolaz ne pravi duplu poruku.
24. In-app inbox je obavezan kanal i radi bez SMTP-a (`BLOCKED_NO_PROVIDER` važi samo za email).
25. **Eskalacija, jedna razina:** ako je `daysLeft ≤ 3` i obavještenje nije označeno „riješeno“ (`notifications.resolved_at IS NULL`), dodatna poruka ide OWNER-u (`escalation_level=1`, `dedupe_key` sa sufiksom `:esc`).
26. „Riješeno“ se veže na obavještenje, ne na obavezu — obaveza se obnavlja dokumentom, obavještenje se zatvara.

### 1.5 Prilozi (jedan servis)
27. Jedan `attachment-service` (u `packages/`-nivou ili `apps/web/src/server/attachments/`) za sve module: `obligation`, `tender`, `daily_check`, `fault`, kasnije `service_order`/`hse`.
28. Pravila ostaju: tip iz prvih bajtova (ne ekstenzija, ne `content-type` zahtjeva), potpisani PUT 5 min / GET 60 s, `pending → ready`, SHA-256 dedupe po vlasniku, max 10 MB, dozvoljeni tipovi `pdf/jpeg/png/webp/heic`.
29. Tri postojeće kopije (`obligation-service`, `tender-attachment-*`, `daily-check-attachment-*`) se zamjenjuju; ponašanje i API odgovori ostaju isti.
30. `requires_attachment` se **provjerava**: obaveza sa `expires_at` bez ijednog `ready` priloga ne može preći u `pending_review`/biti potvrđena; u listi nosi oznaku **„Nema priloga“** i filter po tome.
31. Retencija: `sensitive` prilog se briše **24 mjeseca** nakon `workers.ended_at` (ili deaktivacije ako `ended_at` nema); noćni job briše objekat u bucketu + red, upisuje `audit` (`attachment.retention_purged`, bez sadržaja). Nesensitivni prilozi: 10 g. (uz obavezu), isto pravilo.
32. Čitanje `sensitive` priloga upisuje `ACCESS` audit (Modul 1 §42).

### 1.6 Masovni rad (ured)
33. **Grupna obnova:** jedan dijalog → N obaveza, iste vrijednosti (broj izdavača, datum izdavanja, datum isteka) → N novih verzija u **jednoj transakciji**; jedna greška = ništa nije upisano.
34. **Uvoz iz Excela** (`tip, entitet, broj, izdavač, izdato, istječe`) kroz postojeći `previewImport/applyImport` obrazac: pregled grešaka prije potvrde, „sve ili ništa“, duplikati se prijavljuju (ista obaveza = entitet + tip + isti `expires_at`).
35. **CSV/PDF izvoz** trenutnog filtera, sa zaglavljem firme (Modul 1: logo, naziv, PIB) — za sastanak, inspekciju i arhivu.
36. **Kalendar rokova** (mjesec/sedmica) sa gustinom po danu; klik na dan filtrira listu.

### 1.7 Teren
37. Mobilni `GET /api/me/blockers` pri otvaranju „Moj dan“, „Sati mašine“, „Ture“: crvena traka sa tipom, datumom isteka i uputom „javi se uredu“ za blokirajuće; žuta za `missing`/`pending_review`.
38. Read-only lista rokova ostaje; uz nju kratka akcija „Pošalji prilog“ za radnika (kamera) kad tip to dopušta — upload ide kroz outbox kad se vrati mreža.

---

## 2. Promjene na bazi

| Objekat | Promjena |
|---|---|
| `obligation_types` | `+ requires_review bool default false`, `+ sensitive bool default false`, `+ blocks_actions text[]` (koje radnje blokira; default `{assign}`) |
| `obligations` | `+ reminder_days INT[] NULL`, `+ review_at DATE NULL`, `CHECK (expires_at IS NOT NULL OR review_at IS NOT NULL)` (trajna obaveza mora imati datum provjere), `+ reviewed_by/reviewed_at` |
| `obligation_overrides` (novo) | `id, company_id, subject_kind (WORKER/MACHINE/TENDER), subject_id, action, reason, valid_from, valid_to, requested_by, approved_by, approved_at, status (REQUESTED/APPROVED/REJECTED)` — zamjenjuje `project_assignment_overrides` (migracija prenosi postojeće redove, `subject_kind=WORKER`) |
| `obligation_requirements` (novo) | `id, company_id, entity_kind, type_id, applies_scope (ALL/ENGAGEMENT/MACHINE_CATEGORY/PROJECT), applies_value text NULL, is_required, is_active`, unique `(company_id, entity_kind, type_id, applies_scope, applies_value)` |
| `obligation_notify_roles` (novo) | `id, company_id, type_id, role` (Role enum), unique `(company_id, type_id, role)` |
| `attachments` — konsolidacija | `tender_attachments` i `machine_daily_check_attachments` ostaju kao „veza“, ali pravila idu u jedan servis; `+ retention_after_months` i `+ purged_at` gdje treba |
| `obligation_state()` | proširenje: prihvata `p_review_at`, vraća i `review_due`; `missing` se **ne** računa ovdje (nije red) |

Sve nove tenant tabele: `ENABLE`/`FORCE RLS`, politika po `company_id`, unos u `privilege-matrix.tsv` i preflight.

---

## 3. API ugovor

| Metoda | Ruta | Dozvola |
|---|---|---|
| GET | `/api/obligations` (+ `?state=missing&missingFor=WORKER`) | `obligations.view` |
| GET | `/api/obligations/missing` | `obligations.view` |
| POST | `/api/obligations/missing/create` | `obligations.manage` („Kreiraj sve nedostajuće“) |
| GET/POST/PATCH/DELETE | `/api/obligation-requirements` (+`/:id`) | `obligations.manage` |
| POST | `/api/obligations/bulk-renew` | `obligations.manage` |
| POST | `/api/obligations/:id/review` (potvrdi/odbij) | `obligations.review` (nova) |
| POST | `/api/obligations/:id/review-at` (trajni rok) | `obligations.manage` |
| GET | `/api/obligations/export?format=csv\|pdf` | `obligations.view` |
| POST | `/api/obligations/import/{preview,apply}` | `obligations.manage` |
| GET | `/api/me/blockers` | authenticated |
| POST/GET | `/api/obligation-overrides`, `/api/obligation-overrides/:id/decide` | `projects.override` (postojeće) |
| POST | `/api/obligations/:id/attachments` (+`confirm`, `url`) | `obligations.attachments.view/manage` |

Nove dozvole: `obligations.review`, `obligations.attachments.manage`. Novi kodovi: `OBLIGATION_BLOCKED`, `OBLIGATION_ATTACHMENT_REQUIRED`, `OBLIGATION_REVIEW_REQUIRED`.

---

## 4. UI / UX

| Ekran | Sadržaj | Napomena |
|---|---|---|
| `/ured/rokovi` | 7 stanja kao segmenti, filter „Nema priloga“, filter po tipu/entitetu/odgovornom, red po prioritetu | indikator `missing` i `pending_review` kao chip |
| Detalj obaveze | verzije + prilozi + `review_at` + iznimke + audit | dugmad: Obnovi, Ispravi (24 h), Pošalji na provjeru, Potvrdi/Odbij |
| „Nedostaje“ tab | tabela entiteta × tipova, checkbox + „Kreiraj sve nedostajuće“ | ovo je novi glavni ekran ureda |
| Zahtjevi (`/ured/rokovi/zahtjevi`) | pravila po tipu firme | |
| Grupna obnova | dijalog sa N redova, jedna potvrda | greška = ništa upisano |
| Kalendar | mjesec, gustina po danu | |
| Mobilni „Moj dan“/„Sati mašine“/„Ture“ | crvena/žuta traka blokada | unos goriva **uvijek** dopušten uz crveno upozorenje |

---

## 5. Testovi

1. `missing` se računa tačno (entiteti bez obaveze), ne pravi redove; deaktiviran radnik izlazi iz računa.
2. `canUseEntity`: blokira `assign/haul/machine_hours/tender_submit` na `expired`; **ne** blokira `fuel` ni `workday`; `pending_review` ne blokira.
3. Iznimka: važi samo za svoj subjekt i radnju, ističe po `valid_to`, traži odobrenje i razlog; istekla ne pušta.
4. `requires_review`: bez potvrde obaveza ostaje `pending_review`; `rejected` blokira i traži razlog.
5. `requires_attachment`: bez `ready` priloga nema prelaska u provjeru; filter „Nema priloga“ vraća tačan skup.
6. `review_at`: trajna obaveza bez `review_at` se odbija; `review_due` ulazi u podsjetnike.
7. Podsjetnik: `dedupe_key` sprječava duplu poruku pri ponovnom prolazu; eskalacija ide OWNER-u samo ako nije riješeno.
8. Retencija: 24 mj. nakon `ended_at` briše objekat i red, upisuje audit bez sadržaja.
9. Grupna obnova: 12 obaveza, jedna neispravna → 0 upisanih.
10. Izolacija: firma B ne vidi obaveze, priloge, iznimke ni zahtjeve firme A.

---

## 6. Van opsega
Višerazinska eskalacija · SMS/Viber kanal · potpis na dokumentu (Modul 9) · OCR čitanja dokumenata (B15.18, kasnije).

# R5 — Mehanizacija u radu (plan, bez koda)

**Status:** čeka odobrenje vlasnika. **Izvor opsega:** `MASTER_BRIEF.md` §R5 / mehanizacija;
R4b zatvoren (`PLAN-R4.md` §11). Nema implementacije dok vlasnik ne kaže DA.

## Model podataka (predlog)

| Entitet | Svrha | Tenant |
|---|---|---|
| `machine_work_logs` | Radni sati mašine (rad / praznohod / kvar) po danu + veza na projekat/dodjelu | `company_id` |
| `machine_meter_readings` | Brojilo (sati ili km); append-only historija | `company_id` |
| `hauls` (ture) | Vožnja: mašina, vozač, projekat, količina, polazak/dolazak | `company_id` |
| `fuel_entries` | Točenje (l, cijena+valuta, odometar/sati, lokacija); jedan izvor istine | `company_id` |
| `machine_daily_checks` | Dnevni pregled (check-lista, foto, ishod) | `company_id` |
| `machine_faults` | Prijava kvara; veza na pregled/log | `company_id` |

Trošak po satu = izvod iz amortizacije/goriva/servisa/rukovaoca (računato, ne dupli unos). Ispravke ture/goriva: amendment (kao R4b revise), original se ne prepisuje.

## Dizajn (ukratko)

Apple-linear; mobilni: vozač (ture, gorivo), rukovalac (sati, pregled, kvar); ured: lista + filteri.
Boolean → switch; razlozi ≥10 znakova gdje treba audit. Nove vrste UI komponenti samo uz odobrenje.

## Migracije / sigurnost

FORCE RLS na sve nove tabele; `privilege-matrix.tsv` + preflight (nema DELETE app roli gdje nije odobreno);
tenant samo kroz `withCompany`; indeksi za (company_id, machine_id, work_date). Bez ad-hoc SQL van migracije.

## Testovi

| Šta | Dokazuje |
|---|---|
| Integracija RLS | druga firma ne vidi logove/ture/gorivo |
| Unique / overlap | dva aktivna brojila istog tipa / preklop sati → odbijeno |
| Idempotencija sync | ponovljeni mobilni receipt ne duplira turu/gorivo |
| Amendment | ispravka kreira reviziju; original LOCKED/nepromjenjiv ostaje |
| E2E (ured) | unos sati → vidi se na listi; računovođa bez mutate dugmadi |

## Van obima R5

Stacionaža UI/uvoz trase; partneri UI; opšti B15 workflow nabavke; SaaS naplata; GPS; servisni nalozi u dubinu; Android store.

## B15 \[Rano u model\] — dopušta li trenutni model?

| Stavka | | |
|---|---|---|
| Stacionaže (1) | **NE** | Nema tabela; samo komentar u `schema.prisma` L7. *Izmjena (ne primjenjuj):* `route_segments` (project_id, from_km_m, to_km_m) + FK na unose rada. |
| Partneri | **NE** | Nema `partners`; komentar L7. *Izmjena:* `partners` + `partner_roles` (supplier/subcontractor/client), `company_id`, FORCE RLS. |
| Tok odobravanja (14) | **NE** | R4b je samo radni dani/sedmica (`PLAN-R4.md` §11 „B15§14 bio NE→R5“); nema pragova iznosa. *Izmjena:* `approval_flows` / `approval_steps` / pragovi po `company_id`, vezivo za nabavku/trošak. |
| Valuta uz iznos | **NE** (djelimično DA) | `companies.currency` postoji (`init` migracija); nema `currency` uz svaki iznos u troškovnim tabelama. *Izmjena:* pravilo Money — svaki `amount` + `currency_code` (default iz firme). |
| SaaS tenant | **DA** (spremnost) | Tenant = `companies` + `memberships` bez `User.companyId` (`schema.prisma` L4–5, L69–70); planovi/naplata još nisu tabele (namjerno kasnije). |

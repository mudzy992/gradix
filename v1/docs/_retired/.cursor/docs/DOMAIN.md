> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Gradix — domen

Interni + javni sistem za niskogradnju: ured (web), teren (Expo), javni one-page firme, flota (telefon pa IoT), troškovi, tenderi, dnevnik, plate (sati × stopa).

Izvor pravila: [DECISIONS.md](./DECISIONS.md) + matrice + [PLAN_FREEZE.md](../plans/gradix-core/PLAN_FREEZE.md).

## Glosar

- **Firma (`Company`)** — tenant. Svi poslovni podaci nose `companyId`.
- **PLATFORM_ADMIN** — operator instalacije; nije zaposlenik firme.
- **SUPER_ADMIN / ADMIN** — administracija unutar firme.
- **Projekat** — posao za naručioca, ima faze, budžet, geofence centar.
- **Faza** — isječak projekta (iskop, cijevi, asfalt).
- **Zadatak** — nalog za teren; može imati više ljudi; mašina se veže na timer, ne mora na task.
- **Tura** — jedna vožnja materijala (vozač + kamion + projekat + materijal + količina).
- **Deponija** — odredište sa QR; polazište je tekst + GPS (gradilište/kamenolom).
- **Karton mašine** — identitet, sati, dokumenti, servis, gorivo, zadnja lokacija.
- **Dnevnik građenja** — jedan zapis po projektu po kalendarskom danu (timezone firme).
- **Cisterna / pumpa** — izvor goriva; lager cisterne je ERP faza, evidencija sipanja je ops faza.
- **Partner** — klijent ili dobavljač (ERP-lite); do te faze `Project.client` je string.
- **IoT uređaj** — GPS tracker na mašini; isti `GpsRecord` kao telefon.
- **HSE incident** — prijava na terenu (foto + GPS + tekst).
- **Amendment** — ispravka timer/ture/goriva (SS/ADMIN); šema od Faze 2.
- **Obračun** — odobreni sati × `hourlyRate`; GPS nije dokaz; pause se ne plaća.
- **Predmjer** — plan vs izvedeno po fazi (m³, t, m); nije % progress taskova.
- **Na terenu** — zadnji GPS ping ≤30 min u geofence; nije dokaz za plate.
- **Temp lozinka** — ADMIN vidi jednom na create; radnik mora promijeniti prije rada.
- **Ime** — `firstName` + `lastName` obavezno; `employeeCode` opcion po firmi.

## Entiteti po sloju

**Core (Faza 1–2):** Company (+ pravna polja, email), User (ime, employeeCode, mustChangePassword, locale), roles, Device, Setting, Notification, AuditEvent, Project (+ code, locality, planned dates), Phase, Assignment, Task, TimerSession, ProjectDocument, QuantityItem, Amendment (šema; TRIP/FUEL write Faza 4).

**Ops (Faza 4–6):** Machine, Trip, Material, Deponija, FuelEntry, GpsRecord, UserLocation, Diary, Incident (HSE online-only).

**Ured (Faza 7):** Tender, Service (+ IN_SERVICE), company/worker/machine documents (warn), fiksni reports, CI bez CD.

**Proširenje (Faza 8–11):** public `/p/:slug` + PublicAsset, payroll (mjesec TZ, SS ne odobrava sebe), Partner + CostEntry + Warehouse SITE|YARD|CISTERN, 1 IoT device / mašina.

## Tokovi (srećan put)

1. ADMIN kreira projekat, faze, predmjer, dodijeli PM/SS/radnike/mašine.
2. ADMIN kreira radnika → temp lozinka jednom → force change → SS dispatch task → in-app → radnik start timer (opciono mašina, GPS ako ima). Pause ne teče; 12h auto-close.
3. Vozač evidentira turu offline → sync.
4. SS piše dnevnik; PDF kasnije.
5. WON tender → projekat (prazne faze).
6. Cron: isteci dokumenata, servis po satima, fuel anomaly.
7. HSE prijava sa terena (Faza 6).
8. Acc vidi troškove i export sati.

## Ekrani × permisije

Vidi [matrices/screens/MATRIX.md](./matrices/screens/MATRIX.md). Nav = unija permisija, liste = [data-scope](./matrices/data-scope/MATRIX.md).

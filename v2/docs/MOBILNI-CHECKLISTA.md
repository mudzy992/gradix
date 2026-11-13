# Mobilni prolaz — potpuna ček-lista

**Stanje:** komit `652c4b2` (A1 zatvoren: granica kontrolnih znakova kroz sve rute).
**Šta pokriva:** sve što je do ovog trenutka implementirano na mobilnom i može se
provjeriti ručno na telefonu. Redoslijed sektora je po važnosti — sekcija 1 je
originalni A1 bug i nju uradi prvu.

**Trajanje:** cijeli prolaz ~30–45 min; sama sekcija 1 ~5 min.

---

## 0. Priprema

- Aplikacija na telefonu kroz Expo Go po `docs/MOBILE-EXPO-GO.md`
  (telefon i računar na istoj Wi-Fi mreži, `apps/mobile/.env` s `EXPO_PUBLIC_API_URL`
  na testnu domenu; poslije izmjene `.env` obavezno `pnpm start -- --clear`).
- Demo nalozi (ako je okruženje seedovano demo svijetom):

  | Email | Uloga | Šta od njega očekujemo |
  |---|---|---|
  | `radnik@demo.ba` | radnik | Moj dan, rokovi, projekti; BEZ Grupa |
  | `sef@demo.ba` | šef gradilišta | sve od radnika + Grupa (ekipa) |
  | `voditelj@demo.ba` | voditelj projekta | IMA Moj dan (vezan na radnika), projekti samo dodijeljeni |
  | `vlasnik@demo.ba` | vlasnik | BEZ Moj dan i BEZ Grupa (nije vezan na radnika) |

  Lozinka je ona s kojom je okruženje seedovano (`SEED_PASSWORD`; u CI-u je to
  `E2eDemoLozinka-123`). Ako tvoje okruženje koristi druge naloge, koristi svoje —
  koraci su isti.
- Za svaki nalaz: **screenshot + vrijeme + nalog + tačan korak**. Ako nešto padne,
  to je nalaz, ne smetnja — upiši i nastavi ako može.

---

## 1. Prijava, odjava, sesija — NAJVAŽNIJE (A1)

- [ ] Prijava `radnik@demo.ba` → početni ekran nosi ime firme i ime i prezime,
      dugmad: **Moj dan, Moji rokovi, Moji projekti, Odjavi se** (BEZ „Grupa").
- [ ] Pogrešna lozinka → poruka **„Prijava nije uspjela."** — jasna poruka,
      aplikacija ne pada.
- [ ] **A1 SEKVENCA (originalni bug):** „Odjavi se" → potvrdi u prozoru →
      **ponovna prijava istim korisnikom** → mora uspjeti, bez
      „Došlo je do greške." Ponovi 2–3 puta zaredom.
- [ ] Odjava sa neposlanim redovima: napravi offline unos (sekcija 3), pa se odjavi
      → prozor objašnjava da neposlani zapisi ostaju sačuvani za isti nalog →
      ponovna prijava istim nalogom → „Čeka slanje" je i dalje tu.
- [ ] Zatvori aplikaciju potpuno (iz pregleda nedavnih aplikacija) → ponovo otvori
      → i dalje prijavljen, bez ponovne prijave.
- [ ] *(napredno, uradi na kraju ili s nalogom koji ti više ne treba — mijenja
      lozinku)* Prijavi `voditelj@demo.ba` na telefonu; na webu se prijavi istim
      nalogom i promijeni lozinku → na telefonu ponovo otvori aplikaciju →
      poruka **„Prijava više nije važeća — sesija je opozvana ili istekla…"**
      (web pri promjeni lozinke opoziva sve druge sesije tog naloga).

## 2. Moj dan (radnik)

- [ ] Unos: Početak `07:00`, Kraj `15:30` → „Sačuvaj na telefon" → „Pošalji sada"
      → **„Poslano" / „Sve je poslano."**
- [ ] Ponovno „Pošalji sada" → **bez duplikata**; na webu (ured → Radni dani) za taj
      dan stoji JEDAN zapis.
- [ ] Pogrešan format vremena (npr. `7h` ili prazno) → očekuje se jasna poruka
      odbijanja, ne tiho prihvaćen pogrešan zapis. Ako prođe tiho — to je nalaz.

## 3. Offline (avionski režim) — redoslijed bitan

- [ ] Prijavi se **online**, tek onda uključi avionski režim → „Moj dan" → unos →
      „Sačuvaj na telefon" → „Pošalji sada" → **„Čeka slanje"** uz poruku da zapis
      ostaje na telefonu.
- [ ] Dva unosa dok si offline → oba stoje u redu čekanja.
- [ ] Isključi avionski režim → „Pošalji sada" → „Poslano" / „Sve je poslano." →
      ponovno „Pošalji sada" → i dalje „Sve je poslano." (bez duplikata; potvrda
      na webu — jedan zapis po danu).
- [ ] Offline čitanje: avionski režim → „Moji rokovi" i „Moji projekti" → prikazuje
      se zadnje preuzeto uz poruku **„Nema veze. Prikazujem zadnje preuzeto."**
- [ ] *(napredno)* Odjava u avionskom režimu → poruka da je odjava lokalna i da
      server sesija nije mogla biti opozvana bez mreže (javi se uredu za opoziv).

## 4. Grupa — samo `sef@demo.ba`

- [ ] Prijava `sef@demo.ba` → meni ima **„Grupa — unos za ekipu"**.
- [ ] Izaberi projekat → radnici u opsegu se učitavaju → zajednička mašina ili
      „Bez mašine" → Početak/Kraj za sve → „Sačuvaj za N radnika" → „Pošalji sada"
      → **„Poslano"** i nigdje riječ „Odbijeno" za ijednog radnika.

## 5. Moji rokovi (radnik)

- [ ] Samo **sopstveni** rokovi: tip, datum i stanje (isteklo / istječe danas /
      unutar 30 dana / važeće / bez roka). Tuđi rokovi se NE vide.
- [ ] Prilozi (skenovi, nalazi) se NE vide — namjerno (lični podaci).
- [ ] „Osvježi" povlači novi spisak.

## 6. Moji projekti (radnik)

- [ ] Samo **dodijeljeni** projekti sa statusom (Aktivan / Pauziran / Završen /
      Otkazan) → „Osvježi".

## 7. Role — šta ko smije vidjeti

- [ ] `vlasnik@demo.ba`: BEZ „Moj dan" i BEZ „Grupa" — samo rokovi, projekti, odjava.
- [ ] `voditelj@demo.ba`: IMA „Moj dan"; projekti samo dodijeljeni (sužen opseg).
- [ ] `radnik@demo.ba`: BEZ „Grupa".

## 8. Teme i izgled

- [ ] Dugme „Tamna"/„Svijetla" na početnom ekranu prebacuje temu odmah; tekst čitljiv
      u oba; statusna traka prati temu.
- [ ] Prvo pokretanje: fontovi učitani (Manrope) — bez treperenja sistemskog fonta.

---

## Šta ostaje u automatskim testovima (ne probaš ručno)

- **Istek tokena i tiho obnavljanje (refresh)** — čeka istek tokena; pokriveno
  testovima klijenta.
- **Kontrolni znak iz tipkovnice/autofilla** (uzrok A1 buga) — ne reproducira se
  ručno pouzdano; server garantuje 400 umjesto 500 kroz sve rute, klijent čisti
  email prije slanja (nul-guard sweep + client testovi).
- **Idempotentnost sinkronizacije na serveru** — serverski testovi; na telefonu se
  vidi samo posljedica (bez duplikata).
- **Pregled (C.1 „šta moram danas uraditi?")** — samo web u ovom rezu, na mobilnom
  ga nema (namjerno).
- **Katalog** — samo u razvojnoj gradnji; u produkcijskoj poruka
  „Dostupno samo u razvojnoj gradnji."

## Kako prijaviti nalaz

Za svaku stavku koja ne prođe: screenshot, vrijeme, nalog, tačan korak iz liste.
Nalaze dostavi u izvještaju prolaza — svaki ide na popravku prije pilota.

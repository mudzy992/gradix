# R4a-2 — Ekran za rješavanje sukoba (PLAN, nije isporučeno)

**Status:** Ekran za rješavanje sukoba **nije isporučen** u Step 7 i ne postoji u kodu.
Ovo je samo prijedlog plana (≤1 strana). Implementacija počinje tek nakon odobrenja vlasnika.

## Šta server već radi (postojeće, Step 6)

Push koji pogodi zauzet slot vraća `conflict`; zapis ostaje na telefonu i u uredskom
pregledu `Radni dani` dobija oznaku **„Za provjeru“**. Ništa se ne briše i ništa se
automatski ne prepisuje — sukob danas samo čeka čovjeka.

## Prioritet (redoslijed isporuke)

1. **Ured vidi sukob** — u `Radni dani` zaseban prikaz „Za provjeru“: radnik, projekat,
   datum, postojeći (server) zapis i pristigli (telefon) zapis, jedno pored drugog.
2. **Prihvati jedan unos** — ured bira koji zapis važi (server ili telefon); drugi se
   arhivira kao odbačena verzija, ne briše se.
3. **Ispravi vremena** — prije prihvatanja ured može ručno ispraviti početak/kraj
   izabranog unosa; ispravka je novi, vidljiv podatak (original ostaje u auditu).
   Vremena iz dva unosa se **ne spajaju automatski** (odluka vlasnika).
4. **Odbaci** — pristigli unos se može odbaciti uz obavezan kratak razlog
   (jedna rečenica) koji radnik vidi na telefonu; interne napomene ureda radnik ne vidi.
5. **Audit** — svaka odluka (ko, kada, šta je izabrano, šta je ispravljeno, razlog)
   ide u postojeći audit log; telefon pri sljedećem syncu sazna ishod svog zapisa.

## Granice prijedloga

- Bez novog protokola: odluka ureda putuje postojećim pull kanalom (event po zapisu).
- Telefon nikad ne odlučuje o sukobu; radnik vidi ishod, a kod odbacivanja i kratak
  razlog (jedna rečenica) — interne napomene ureda ne vidi.
- Samo uloge OWNER/ADMIN odlučuju; šef vidi sukobe svoje ekipe, ne odlučuje.
- „Van opsega“ (scope) nije sukob i ne ulazi u ovaj ekran — ostaje kako je u Step 7.

## Otvorena pitanja za vlasnika (prije koda)

1. Smije li ured spajati (npr. početak sa telefona + kraj sa servera) ili samo birati jedan unos uz ispravku vremena?
2. Rok za rješavanje: smije li dan ostati „Za provjeru“ neograničeno ili treba podsjetnik uredu?
3. Vidi li radnik na telefonu razlog odbacivanja ili samo da je ured riješio dan?

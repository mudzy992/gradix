# Maestro tokovi — ručno pokretanje na uređaju/emulatoru

Direktorij `maestro/ci/` nosi pet tokova za mobilnu aplikaciju (protiv pravog
API-ja s demo svijetom). Od 2026-11-16 NIŠTA od ovoga ne ide u CI automatski:
workflow „Mobilni E2E (Maestro)" je parkiran (samo ručni `workflow_dispatch`),
a tokovi su namijenjeni ručnom pokretanju na vlasnikovim uređajima — ovaj
README je vodič. Razlikuju se od tokova u `maestro/` (višesmjerni scenariji
za potpuno ručni prolaz): ovi su autonomni jednom kad se preduslovi postave
(kredencijali se otkucaju ručno, mreža prebaci ručno — vidi dolje).

## Redoslijed i faze

| Tok | Faza | Šta dokazuje |
|---|---|---|
| `01-snimci` | mreža ON | prijava, obilazak ekrana, **A1e: odjava pa ponovna prijava** |
| `02-offline-prijava-i-kes` | mreža ON | prijava radnika + osvježavanje rokova/projekata u keš; završava na formi „Moj dan" |
| `03-offline-unos` | mreža OFF | unos bez veze — „Čeka slanje", zapis ostaje na telefonu; čitanje rokova/projekata iz keša |
| `04-povratak-mreze` | mreža ON | slanje čekanog zapisa tačno jednom; ponovno slanje ne pravi duplikat |
| `05-grupa` | mreža ON | šef: grupni unos za radnika iz ekipe, ishod „Poslano" bez „odbijeno" |

Fajlovi `_fokus-email.yaml` i `_fokus-lozinka.yaml` NISU tokovi — to su
pomoćni mini-flowovi koje orkestrator (`scripts/maestro-ci.sh`, funkcija
`adb_login`) poziva između adb poziva da fokusira polje prijave (vidi dolje
„Unos teksta u CI").

Mrežu između faza prebacuje `scripts/emulator-net.sh` (adb, s provjerom pingom),
a redoslijed i retry politiku nosi `scripts/maestro-ci.sh`. Ulazna tačka emulator
koraka CI-ja je `scripts/emulator-ci.sh` (animacije off, `adb install` APK-a, pa
maestro-ci.sh — workflow ga zove u JEDNOM redu, jer android-emulator-runner razbija
script po redovima i svaki red pokreće kao zaseban `sh -c`). Scenariji:
`sve` (uobičajeno), `snimci`, `offline`, `grupa` — biraju se pri ručnom
pokretanju workflowa; noćni run ide s `sve`.

## Namjerna rješenja (da se ne „popravlja" napamet)

- **Vremena se ne tipkaju** — polja „Moj dan"/„Grupa" imaju validne defaulte
  (07:30–15:30). Manje koraka = manje lažnih padova; tipkanje vremena ne dokazuje
  ništa dodatno.
- **`id:` selektori rade jer TextField postavlja `testID`** (isto ime kao
  `accessibilityLabel`). Ranije su tokovi koristili `id: "Email"` bez da ga app
  postavlja — na Androidu `id` čita resource-id, a `accessibilityLabel` završi u
  `text:` selektoru.
- **Grupa bira Nedima, ne Amara** — u scenariju „sve" bi radnikov sopstveni unos
  (tokovi 02–04) i grupni unos za istog radnika u istom danu napravili sukob.
- **Potvrda odjave bez indexa** — Alert dijalog je zaseban prozor: dok je
  otvoren, a11y stablo izlaže samo njegove čvorove, pa je „Odjavi se" u
  dijalogu jedini dostupni match (`text:` selektor, bez indexa).
- **Unos teksta u CI ide adb putem, ne Maestro inputText** — Maestrov
  key-event unos (znak po znak) na sporom emulatoru trči s RN re-renderom
  polja i nondeterministički duplira cijeli string ili gubi znakove
  (dokazano runovima: email tačno ×2; lozinka 9 od 13 znakova). IME put
  (atomic `commitText`) na aosp_atd slici ne postoji. Zato orkestrator
  fokusira polje mini-flowom (`_fokus-*.yaml`) i unosi sadržaj komandom
  `adb shell input text` — egzaktno (run 43708006955: prijava prošla).
  Tokovi 01/02/05 zato počinju direktno sa „Prijavi se", a A1e re-prijava
  poslije odjave je isto samo submit — `finishSignOut` ne prazni polja.
- **App ne starta `launchApp` u tokovima** — startActivity iz Maestrovog
  drajvera razbija input fokus prozora (dugme ne reaguje), a restart procesa
  vraća window fokus na ATD launcher (tok „slijep"). Orkestrator starta app
  (`am start`), launcher je ubijen na početku skripte, a fokus se čeka
  dumpsys anketom (BACK otpušta ANR dijalog system procesa ako ga uhvati).
- **Keš mora biti svjež prije gašenja mreže** — zato tok 02 osvježava rokove i
  projekte DOK JE mreža uključena.
- **Offline tokovi NE smiju ni restartovati ni remountati app** — `index.tsx`
  bootstrap zove `me()` (provjera sesije) PRIJE home ekrana, a `load()` forme
  „Moj dan" zove `me()/myProjects()/machines()` — bez mreže ne radi NI hladni
  start (run 43769430158: „Moj dan" nije vidljiv ni nakon 45 s) NI ponovni
  ulaz na formu (run 43821193657: prazan spisak projekata → save kaže
  „Izaberi projekat."). Zato orkestrator ima tri režima po toku: `pm clear` +
  start (01/02/05 — svježa prijava), force-stop + start (04 — online start
  prolazi kroz `me()`, keš ostaje) i „nastavi" (03 — app se NE DIRA: forma iz
  toka 02 ostaje montirana s podacima, tok nastavlja direktno na njoj, RN
  stanje i sesija ostaju živi; retry također bez resetiranja).
- **Elementi van vidljivog dijela ekrana — `scrollUntilVisible`, ne
  `assertVisible`** — Galaxy Nexus ekran je mali, a ekrani sadržajno duži od
  njega: „Osvježi" je na dnu spiska rokova/projekata (poslije svih kartica),
  dugmad „Sačuvaj na telefon"/„Pošalji sada"/„Sačuvaj za N radnika" su na dnu
  svojih kartica, a status zapisa („Čeka slanje"/„Poslano") u kartici
  „Moji zapisi" još niže. `assertVisible` na takvom elementu pada čim sadržaj
  prekloni ekran (dokazano runovima 43733676496 i 43756628616), a padaju i
  asercije POSLIJE akcije koja re-renderuje listu (re-render gura element iz
  vidika). Zato: prije tapinga/asercije na dno-element ide `scrollUntilVisible`,
  a poslije akcije koja mijenja listu skrol se PONAVLJA. Povratak s ekrana
  ide `back` — „‹ Nazad" je poslije skrola izvan vidika.
- **Poruke na vrhu ekrana vraćaju se skrolom GORE** — poruka
  „Nema veze. Prikazujem zadnje preuzeto." je na VRHU spiska, pa poslije
  skrola do „Osvježi" (dno) nije u vidiku; `scrollUntilVisible` s
  `direction: UP` vraća do nje. Re-mount (back + ponovni ulaz) NE radi —
  svježi ekran resetuje poruku iz stanja.
- **Poruke uz dugmad su ISPOD folda — do njih se skrola** — `message` na
  formama „Moj dan"/„Grupa" renderuje se odmah ISPOD oba dugmeta (ista
  kartica): poslije `scrollUntilVisible` do dugmeta, dugme je na dnu ekrana
  pa poruka NIJE u vidiku (run 43826875691: asercija na „Sačuvano na
  telefonu" pala iako je save prošao). Zato se i do poruke skrola
  (`scrollUntilVisible`), a za povratak na dugmad ide `direction: UP`.
  Banner („N čeka slanje.") je obrnuto — na VRHU forme, vidljiv samo čim se
  ekran otvori, prije skrolanja.
- **„Poslano" (veliko P) ≠ „poslano" (malo p)** — Maestro text match je
  case-sensitive: statusni label „Poslano" ne matcha poruku
  „Slanje završeno: poslano 1…" ni banner „Sve je poslano.", pa su sva tri
  nezavisni dokazi.

## Dokazi

`maestro test --test-output-dir maestro-artifacts/test-output` ostavlja
po toku: video cijelog toka, screenshot SVAKOG koraka, hijerarhiju pogleda,
logcat i junit XML. (`--analyze` se namjerno NE koristi — flag zove Maestro
Cloud i zna srušiti CLI nakon uspješno završenog toka, pa bi zeleni tokovi
izgledali kao padovi.) Uz to `maestro-artifacts/logcat.txt` (cijeli dump) i
`maestro-artifacts/junit/*.xml`. Workflow sve to objavljuje kao artefakt
`maestro-dokazi` — uvijek, i kada testovi padnu.

## Ručno pokretanje — preduslovi

1. Maestro CLI: `curl -fsSL "https://get.maestro.mobile.dev" | bash`
2. Aplikacija instalirana na uređaju/emulatoru (`ba.gradix.teren`), s
   `EXPO_PUBLIC_API_URL` u bundleu koji pokazuje na server koji je dohvatljiv
   s tog uređaja (za emulator: `http://10.0.2.2:3000`; za pravi uređaj:
   adresa računara na istoj mreži).
3. API podignut s demo svijetom (`./infra/scripts/dev-up.sh` + seed) —
   nalozi: `radnik@demo.ba`, `sef@demo.ba`, lozinka demo naloga.

## Ručno pokretanje — pojedinačni tokovi (pravi uređaj)

Tokovi NE unose email ni lozinku (CI ih je unosio adb putem — Maestro
`inputText` na RN nondeterministički gubi/duplira znakove). Zato se
kredencijali otkucaju RUČNO prije pokretanja toka — tok samo pritišće
„Prijavi se" i nastavlja.

```bash
cd v2/apps/mobile

# Tok 01 — prijava radnika, obilazak, odjava pa ponovna prijava (A1e):
# otvori app, otkucaj radnik@demo.ba + lozinku (NE pritišćaj „Prijavi se"), pa:
maestro test maestro/ci/01-snimci.yaml

# Tok 02 — prijava + osvježi rokove/projekte (keš za offline); završava NA formi:
# odjava (ako si prijavljen), otkucaj kredencijale, pa:
maestro test maestro/ci/02-offline-prijava-i-kes.yaml

# Tok 03 — offline unos: NASTAVLJA na formi iz toka 02!
# ODMAH poslije toka 02 (bez restarta appa!) ugasi mrežu (avionski režim), pa:
maestro test maestro/ci/03-offline-unos.yaml

# Tok 04 — povratak mreže: upali mrežu (avionski režim OFF), pa:
maestro test maestro/ci/04-povratak-mreze.yaml

# Tok 05 — šef, grupni unos: odjava, otkucaj sef@demo.ba + lozinku, pa:
maestro test maestro/ci/05-grupa.yaml
```

**Kritično za tok 03:** app NE smije biti restartovana između tokova 02 i 03
(ni hladni start ni ponovni ulaz na formu) — bez mreže `me()` provjera sesije
i `load()` forme ne prolaze, pa se zapis ne može sačuvati. Tok 03 nastavlja
tačno tamo gdje je tok 02 stao (forma „Moj dan", skrolana do dugmeta).

Dokazi (video, screenshot svakog koraka, junit) ostaju u
`maestro-artifacts/test-output/` i `~/.maestro/tests/` — korisno za snimke.

## Cijeli orkestrator na lokalnom emulatoru ( alternativa)

Na emulatoru s adb pristupom najlakše je pustiti cijeli orkestrator — on
sam prebacuje mrežu, unosi kredencijale adb putem i retreja tokove:

```bash
cd v2/apps/mobile
DEMO_LOZINKA=<lozinka demo naloga> bash scripts/maestro-ci.sh sve   # ili: snimci | offline | grupa
```

(Orkestrator je pisan za CI; na lokalnom emulatoru radi isto ako su adb i
emulator pokrenuti. `--analyze` se NE koristi — flag zove Maestro Cloud i
zna srušiti CLI nakon uspješnog toka.)

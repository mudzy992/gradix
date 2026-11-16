# Maestro CI tokovi — autonomne verzije za GitHub Actions

Direktorij `maestro/ci/` nosi tokove koje workflow **„Mobilni E2E (Maestro)"**
(`.github/workflows/mobilni-e2e.yml`) pokreće na Android emulatoru, protiv
pravog API-ja s demo svijetom. Oni su prilagođeni autonomnom radu — bez ručnih
koraka — i razlikuju se od tokova u `maestro/` (višesmjerno: oni su scenariji
za ručni prolaz na pravom uređaju, s ručnim avionskim režimom).

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
- **Poruke uz dugmad su vidljive s pozicije dugmadi** — `message` na formama
  „Moj dan"/„Grupa" renderuje se odmah ISPOD dugmadi (ista kartica), pa se
  dokazi „Sačuvano na telefonu", „Zapisi ostaju na telefonu" i
  „poslano N, za provjeru M" asertiraju BEZ dodatnog skrola, odmah poslije
  tapinga (takeScreenshot prije provjere = pauza da RN dovrši slanje).
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

## Lokalno pokretanje (emulator umjesto CI)

Najjednostavnije je pokrenuti cijeli orkestrator (on nosi mrežu, retry i
unos adb putem):

```bash
cd v2/apps/mobile
DEMO_LOZINKA=... bash scripts/maestro-ci.sh sve
```

Pojedinačni tok se može pokrenuti i ručno, ali tokovi iz prijave (01/02/05)
očekuju da su polja već popunjena orkestratorom — prije njih pokreni
`adb_login` ekvivalent ručno (`maestro test maestro/ci/_fokus-email.yaml`
pa `adb shell input text "radnik@demo.ba"`, isto za lozinku), a mrežu
prebacuj s `adb shell cmd connectivity airplane-mode enable/disable`.
Preduslovi su isti kao za CI: instaliran APK (`ba.gradix.teren`), API na
`EXPO_PUBLIC_API_URL` iz bundlea, demo svijet seedovan.

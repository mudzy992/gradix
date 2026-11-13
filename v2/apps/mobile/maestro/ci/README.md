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

Mrežu između faza prebacuje `scripts/emulator-net.sh` (adb, s provjerom pingom),
a redoslijed i retry politiku nosi `scripts/maestro-ci.sh`. Scenariji:
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
- **Potvrda odjave (`index: 1`)** — dijalog odjave i dugme na ekranu iza njega
  nose isti tekst „Odjavi se"; bira se drugi po redu. Ako prvi pravi run pokaže
  da je redoslijed obrnut, promijeni index — video iz artefakata pokazuje tačno
  šta je tapnuto.
- **Keš mora biti svjež prije gašenja mreže** — zato tok 02 osvježava rokove i
  projekte DOK JE mreža uključena.

## Dokazi

`maestro test --analyze --test-output-dir maestro-artifacts/test-output` ostavlja
po toku: video cijelog toka, screenshot SVAKOG koraka, hijerarhiju pogleda,
logcat i junit XML. Uz to `maestro-artifacts/logcat.txt` (cijeli dump) i
`maestro-artifacts/junit/*.xml`. Workflow sve to objavljuje kao artefakt
`maestro-dokazi` — uvijek, i kada testovi padnu.

## Lokalno pokretanje (emulator umjesto CI)

```bash
cd v2/apps/mobile
adb shell cmd connectivity airplane-mode enable   # „off" faza kad treba
maestro test -e DEMO_LOZINKA=... maestro/ci/01-snimci.yaml
```

Preduslovi su isti kao za CI: instaliran APK (`ba.gradix.teren`), API na
`EXPO_PUBLIC_API_URL` iz bundlea, demo svijet seedovan.

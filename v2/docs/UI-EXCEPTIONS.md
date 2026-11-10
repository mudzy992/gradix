# U3 — lista izuzetaka od zabrane sirovih elemenata

Ekrani (`apps/web/src/app`, `apps/mobile/src/app` + `apps/mobile/src/teren`) smiju koristiti SAMO
Gradix komponente. ESLint pravila `no-restricted-syntax` padaju na sirovim
`<input>/<select>/<textarea>/<table>/<button>/<dialog>` (web), `TextInput`/`Pressable`/
`TouchableOpacity`/`StyleSheet.create` (mobile) i inline `style={{` (web).

Ova lista sadrži privremene izuzetke PO DATOTEČNOM PREDLOŠKU u `eslint.config.js`.
**Smije se samo smanjivati**: svaki izbrisan red = jedna migrirana datoteka.
Dodavanje novog reda = rez U nije gotov. Fajl >400 linija daje upozorenje (`warn`) —
vlasnik ekrana ga dijeli pri sljedećem dodiru.

## Web (početno stanje: 2026-11-07, prije migracija)

- `apps/web/src/app/login/page.tsx` — autoFocus prvo polje + vizuelno skriven honeypot/label
  obrazac; migrira se s posebnom `hideLabel` varijantom.
- `apps/web/src/app/platform/**` — platform admin UI ima vlastitu paletu (pf-) i sirove
  elemente; migrira se u svom rezu (isti sistem, platform varijanta).
- `apps/web/src/app/**` — ostatak: svaka `*-client.tsx` datoteka do svoje migracije (U7b
  Radnici su predložak; U7c ostatak redom: pregled, projekti, radni-dani,
  masine/zaduzenja, rokovi, uvoz, admin).

## Mobile (početno stanje)

- Mobile: `src/app/_layout.tsx`, `src/app/grupa.tsx`, `src/app/projekti.tsx`,
  `src/app/rokovi.tsx`, `src/teren/**` — ekrani do migracije na `apps/mobile/src/ui/`.
  Migrirano (U7b): `src/app/moj-dan.tsx`, `src/app/index.tsx` (prijava).

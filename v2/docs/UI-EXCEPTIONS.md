# U3 — lista izuzetaka od zabrane sirovih elemenata

Ekrani (`apps/web/src/app`, `apps/mobile/src/app` + `apps/mobile/src/teren`) smiju koristiti SAMO
Gradix komponente. ESLint pravila `no-restricted-syntax` padaju na sirovim
`<input>/<select>/<textarea>/<table>/<button>/<dialog>` (web), `TextInput`/`Pressable`/
`TouchableOpacity`/`StyleSheet.create` (mobile) i inline `style={{` (web).

**Stanje: LISTA IZUZETAKA JE PRAZNA.** Svi produkcijski web i mobilni ekrani su migrirani na
katalog (`components/ui` / `src/ui`). Jedini preostali izuzetak u `eslint.config.js` su test
fajlovi (`**/*.test.tsx`), koji smiju koristiti sirove elemente za potrebe testiranja.

Dodavanje novog izuzetka = rez U nije gotov. Fajl >400 linija daje upozorenje (`warn`) —
vlasnik ekrana ga dijeli pri sljedećem dodiru.

## Vrijeme (24 h)

Sav unos i prikaz vremena je u 24-časovnom formatu: web `formatDateTime` koristi
`hour12: false`, mobilni unos je tekstualni `HH:MM` (24 h), a `<input type="time">` u katalogu
nosi `lang="bs"` da preglednik ne prikaže AM/PM.

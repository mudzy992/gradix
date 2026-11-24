# ADR 0016 — Trajna obaveza ima datum provjere, ne rok; „nedostaje" je posao, ne greška

**Datum:** 2026-11-23 · **Status:** prihvaćeno · **Faza:** 2 (Modul 2)

## Kontekst

Do F2 je obaveza bila „nešto sa datumom isteka". Praksa niskogradnje ima i obaveze koje **ne
ističu** — ljekarski pregled se obnavlja po pravilniku, sertifikat mašine po servisnom intervalu,
ugovor se revidira po procjeni. Za njih datum isteka nema smisla: ako ga upišemo, lažemo da znamo
kad prestaje; ako ga ne upišemo, obaveza ispada iz svih podsjetnika i tiho nestane.

Stari model je zato imao rupu: obaveza bez `expires_at` bila je „vječno važeća", što u praksi
znači **nikad provjerena**. Rupa se ne vidi u testovima sa rokom; vidi se na gradilištu kad
inspektor traži dokument koji je ured prestao gledati.

## Odluka

1. **Trajna obaveza (`expires_at IS NULL`) MORA imati `review_at`.** Umjesto roka nosi datum
   provjere, i taj datum ulazi u iste podsjetnike i u isto stanje (`review_due`).
2. Pravilo je u bazi, ne samo u servisu: **odgođeni constraint trigger**
   `obligations_review_at_required` (`DEFERRABLE INITIALLY DEFERRED`) ponovo čita red i traži
   `review_at`. CHECK nije mogao: `expires_at` piše postojeći trigger _poslije_ INSERT-a, pa bi
   CHECK vidio `NULL`.
3. **Redoslijed poruka je dio ugovora.** Servis prvo provjeri rod entiteta, pa traži datum
   provjere. Bez toga „ljekarski pregled na mašini" prijavi „nema datuma provjere" umjesto
   stvarnog uzroka — korisnik ispravi pogrešnu stvar.
4. **`missing` je stanje posla, a ne greška.** Spisak nedostajućih se računa iz pravila firme
   (`obligation_requirements`: „svaki radnik mora imati ljekarski"), pa je to spisak _obaveza
   koje treba unijeti_, ne neuspjeh sistema. UI ga zato prikazuje kao karticu sa dugmetom
   „Kreiraj sve nedostajuće", a ne kao crveni alert.
5. Blokirajuća stanja su **samo `expired` i `rejected`** (`BLOCKING_OBLIGATION_STATES`). Da li
   blokada pogađa _ovu_ radnju odlučuje `signalBlocksAction`; `isBlockingState` **ne** zavisi od
   radnje, inače se opomena pri evidentiranju goriva tiho izgubi.

## Posljedice

- Masovna obnova prima `expiresAt | null` **ili** `reviewAt`; trajna obaveza se pomjera kroz
  `PATCH /api/obligations/:id/review-at`, ne kroz „obnovi".
- Mobilni ekran mora razlikovati **blokadu** od upozorenja i po boji (`danger` vs `warn`), jer
  radnik na suncu ne čita tekst, a od toga zavisi smije li na gradilište.
- `DELETE /api/obligation-requirements/:id` postoji (pogrešno uneseno pravilo); deaktivacija bi
  ostavila pravilo koje i dalje pravi „nedostajuće". `obligation_notify_roles` se ne briše kroz
  aplikaciju — otud razlika u grantovima, i ona je namjerna.

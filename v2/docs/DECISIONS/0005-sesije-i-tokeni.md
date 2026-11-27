# ADR 0005 — Sesije: kratak JWT + neprozirni rotirajući refresh, bez replay prozora

**Datum:** 2026-11-07 · **Status:** odobreno (implementirano u R0)

## Kontekst

B8 traži provjerenu biblioteku ili jednostavan model sesija koji radi i za web (cookie) i za Expo (token). v1 je evoluirao do D-059: HMAC-lanac nasljednika, generacije, 20-sekundni replay prozor, `REFRESH_REPLAY_SECRET`, koordinirani rollout. B6.16 to imenuje kao prekomjerno složeno. Istovremeno, mobilni klijent ostaje instaliran mjesecima, pa token mora moći biti opozvan.

## Odluka

1. **Access token:** JWT HS256, 15 minuta, nosi `sub` (korisnik), `sid` (sesija) i `companyId`. Ne nosi role — role se čitaju iz baze, jer prava moraju moći pasti odmah.
2. **Refresh token:** 48 slučajnih bajtova (base64url); u bazi samo SHA-256 hash. Rok 30 dana.
3. **Rotacija na svaki refresh**, u jednoj transakciji sa `UPDATE ... WHERE revoked_at IS NULL` (atomski claim). Dva paralelna zahtjeva ne mogu oba proći.
4. **Ponovna upotreba opozvanog tokena = kompromitacija:** gase se **sve** sesije tog korisnika (`AUTH_REFRESH_REUSE`). Nema prozora u kojem stari token još vraća par.
5. **Web:** `httpOnly` + `SameSite=Lax` + `Secure` (u produkciji) cookie. JS ne vidi token, pa XSS ne krade sesiju. **Expo:** isti tokeni kroz `Authorization` zaglavlje, u `expo-secure-store`.
6. **Sesija se provjerava u bazi na svakom zahtjevu** (revoked/expires) — odjava i deaktivacija djeluju odmah, ne za 15 minuta.

## Alternative

1. **Cookies-only (bez tokena u tijelu)** — ne radi za Expo. Odbačeno.
2. **D-059 model (replay prozor)** — rješava izgubljeni odgovor, ali uvodi prozor u kojem ukradeni token daje par, plus koordinirani rollout. Za dvije površine i jednu firmu ne proporcionalno. Odbačeno; ako se pojavi stvarni problem izgubljenih odgovora, rješava se na klijentu (retry) ili idempotency ključem.
3. **Biblioteka (Better Auth / Auth.js)** — razmatrano u B8. Za R0 je ručni model ~200 linija i nula novih zavisnosti; odluka se revidira u Fazi 2 ako zatreba OAuth/MFA.

## Posljedice

- Jedan upit na bazu po zahtjevu više (sesija + membership). Mjeri se protiv p95 ≤ 300 ms.
- **Cijena:** pri svakom refreshu stara sesija se opoziva, pa paralelni refresh iz dva taba može dati `AUTH_REFRESH_REUSE` i odjavu. Ublaženje: klijent šalje refresh serijski (jedan "lock" po tabu); u Fazi 2 se dodaje sinhronizacija tabova.
- **Dug:** nema `logout-all` rute, nema liste sesija u UI-u (R1).
- Ako `AUTH_SECRET` ikad rotira, svi access tokeni padaju odmah — to je namjerno i mora biti u runbooku.

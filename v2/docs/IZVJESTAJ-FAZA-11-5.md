# Faza 11.5 — Passkeys (WebAuthn)

## Obim i korištenje

- `POST /api/auth/passkeys/register/options` i `POST /api/auth/passkeys/register/verify`: registracija u postojećoj punoj sesiji, uz ponovnu lozinku i aktuelni TOTP kod kad je TOTP uključen. Obavezna je WebAuthn verifikacija korisnika (PIN, biometrija i sl.); ne prihvata se samo dokaz prisustva.
- `GET /api/auth/passkeys` i `DELETE /api/auth/passkeys/{id}`: pregled i uklanjanje isključivo ključeva vlasnika sesije. Registracija i brisanje imaju ACCESS audit u transakciji s izmjenom. Korisničko sučelje je na **Moj profil**.
- `POST /api/auth/passkeys/login/options` i `POST /api/auth/passkeys/login/verify`: prijava traži email i passkey, bez kucanja lozinke ili TOTP-a; rezultat je uobičajena sesija i ACCESS audit. Koristi provjeru naloga i aktivnog članstva/firme, te ograničenje pokušaja. Preglednik bez WebAuthn podrške ostavlja postojeću prijavu dostupnom.
- `user_passkeys` i `webauthn_challenges` su globalni korisnički, ne tenant zapisi. Challenge traje najviše pet minuta, vezan je za HttpOnly/SameSite cookie, RP ID i origin i troši se atomskim `DELETE` prije provjere potpisa. Registracija je dodatno vezana za sesiju. Istečene izazove ograničeno uklanja uska definer funkcija pri novom izazovu; ako nema novih pokušaja, preostali istekli redovi čekaju naredni pokušaj.
- `@simplewebauthn/server` provjerava potpis, challenge, origin, RP ID, user verification i counter. Ne-nulti brojač mora rasti; WebAuthn uređaji koji uvijek vraćaju nulu su dopušteni, pa je njihova zaštita od replaya jednokratni challenge. Upis countera i kreiranje sesije su u istoj transakciji i ključ je zaključan.

## Coolify

Na web servisu podesiti `APP_URL=https://gradix.ba101.top` (tačan javni HTTPS origin, bez putanje). `NEXT_PUBLIC_APP_URL` je alternativa; ako su obje postavljene, origini moraju biti isti. Arbitraran `Host` ne uspostavlja povjerenje: bez konfigurisanog origina fallback je dozvoljen samo na `localhost`/`127.0.0.1` u developmentu. Ključevi su vezani za RP hostname, pa promjena domene zahtijeva ponovnu registraciju. Docker Compose prosljeđuje obje ENV varijable.

## Provjere i ograničenja

- Ciljani testovi uključuju stvarni ECDSA WebAuthn potpis i HTTP rute na PostgreSQL/RLS-u: registraciju i svježi TOTP, login, izmjenu potpisa/origina i UV zastavice, isticanje, jednokratni challenge, replay countera i konkurentne zahtjeve, tuđi ključ, zaključani nalog, deaktiviranu firmu i ACCESS audit. UI i axe uključuju fallback bez podrške. NUL registar uključuje svih šest ruta; OpenAPI je generisan.
- Prvi CI na `cb2ddac` prošao je shell preflight i testove, ali Playwright nije mogao razlikovati dugme za lozinku od novog dugmeta za passkey. Zajednički locator je popravljen na tačno ime; ponovni CI se provjerava na završnom commitu.
- Lokalna SQL preflight provjera je izvršena pod aplikacijskom rolom preko Node PostgreSQL klijenta, uključujući matricu. Shell `preflight` ne može lokalno bez `psql`; CI provodi stvarni shell preflight. Zeleni CI vrijedi samo ako je potvrđen na završnom commitu.
- RLS radi prema transakcijskom korisničkom kontekstu koji postavlja pouzdani backend. Aplikacijska DB rola može postaviti taj kontekst, stoga RLS ne predstavlja zaštitu od kompromitovanog backenda ili njegovog DB kredencijala. Stvarna biometrija/uređaj i Coolify deployment nisu ovdje verificirani.
- Reset lozinke ili TOTP-a sam po sebi ne briše passkeys: zasebne ključeve vlasnik uklanja u profilu. Kod sumnje na kompromitovan ključ prvo deaktivirati nalog i pobrinuti se za uklanjanje ključa prije ponovne aktivacije; ne smatrati TOTP reset potpunim opozivom svih vjerodajnica.
- Security & Invariant Sweep za projektni scope servisnih naloga, kvarova i dnevnika ostaje prije pilota. Ovaj dodatak ga ne rješava.

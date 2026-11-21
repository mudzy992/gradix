# ADR 0013 — RLS za globalne identitete i najmanji app ACL

**Datum:** 2026-11-07 · **Status:** prihvaćeno · **Obuhvat:** B — least-privilege PostgreSQL runtime

## Kontekst

Staging izvještaj vlasnika (nije nezavisno provjeren u ovom repozitorijskom sandboxu) kaže da
`gradix_app` nije superuser, nema `BYPASSRLS`, ne posjeduje tabele i da je svaka tabela sa
`company_id` pod RLS-om. Isti izvještaj navodi da su `companies`, `platform_users`,
`schema_migrations` i globalni `users` bili bez RLS-a, uz SELECT/INSERT/UPDATE/DELETE na sve
četiri. Lokalni `gradix_r1b` katalog nezavisno je pokazao isti široki DML na 20 od 21 public
pregledane tabele; `login_attempts` nije imao direktna prava, a `login_attempts_id_seq` je imao
SELECT i USAGE. Lokalni rezultat nije potvrda staginga.

`users` nema `company_id`: email je jedinstven globalno, a identitet može imati članstva. Login
mora pronaći nalog prije nego što zna tenant; prihvatanje pozivnice pravi novi identitet; reset i
promjena lozinke mijenjaju globalnu lozinku. `companies.id` je ujedno tenant ključ, ali se prije
prijave čita i kroz login-članstvo i pregled pozivnice. Zbog tih pre-tenant lookup putanja, ove
registraturne tabele nisu obične tenant tabele sa jednim `company_id = app.company_id` pravilom.

## Odluka

1. **Uključiti RLS na `companies` i `users`.** Runtime čitanja firmi su dozvoljena samo za
   trenutni tenant, članstvo korisnika tokom login lookup-a ili tačan važeći invitation token.
   Korisnički redovi su vidljivi/izmjenjivi samo kroz članstvo trenutne firme, osim login čitanja
   jednog reda za tačan normalizovani email. Aplikacijski INSERT korisnika prolazi samo dok se
   prihvata odgovarajuća pozivnica. Nema DELETE politike ni DELETE granta.
2. **Ne uključivati FORCE RLS na ove dvije globalne tabele.** Migrator/seed radi kao vlasnik i
   održava globalni registry/identitete. Aplikacijska rola nije vlasnik, ne može preuzeti
   vlasničku rolu, nema `BYPASSRLS` i nije superuser; runtime preflight odbija odstupanje.
   Tenant tabele zadržavaju postojeći `FORCE ROW LEVEL SECURITY`.
3. **Ne davati runtime pristup `schema_migrations` ni `platform_users`.** Migrator je jedini koji
   čita zapis migracija; `/api/ready` više ne broji migracije. `platform_users` nema trenutni web
   path. Ako se platform-admin funkcionalnost doda, prvo se definiše zaseban principal ili uska,
   recenzirana funkcija — `gradix_app` ne dobija direktan DML.
4. **Ne zamijeniti `password_hash` čitanja SECURITY DEFINER funkcijom.** Login mora izvršiti
   Argon2id provjeru u aplikaciji, a promjena lozinke mora uporediti unesenu trenutnu lozinku.
   Funkcija koja vrati hash istom `gradix_app` principalu izlaže isti hash i ne stvara novu
   sigurnosnu granicu; široko SECURITY DEFINER vlasništvo bi povećalo rizik. Zadržan je direktni
   SELECT, ograničen RLS-om na tačan email prije login-a ili članstvo trenutne firme.
5. **Sve efektivne table/sequence privilegije moraju tačno odgovarati**
   `packages/db/preflight-checks/privilege-matrix.tsv`. Bootstrap prvo uklanja stare i javne ACL-
   ove; budući objekti dobijaju prava tek kad ih matrica eksplicitno odobri. App nema CREATE na
   `public`, direktan pristup rate-limit tabeli ili sekvenci, niti direktan pristup platform-user
   podacima.
6. `auth_memberships` i `auth_session_by_hash` su SECURITY INVOKER i ostaju pod RLS politikama.
   App može pozvati uske rate-limit SECURITY DEFINER funkcije koje su potrebne pri login-u;
   trigger-only SECURITY DEFINER helperi nisu direktno izvršivi od aplikacijske role.

## Zašto je login/pozivnica/reset i dalje siguran

- **Login:** server normalizuje email i postavlja `app.auth_lookup_email` samo za trajanje lookup
  transakcije. RLS vraća najviše taj red. Password hash se provjerava Argon2id-om, pa tek onda
  `app.auth_lookup_user` otvara članstva; `companies` politika dozvoljava samo firmu tog aktivnog
  članstva.
- **Pozivnica:** preview postavlja hash tokena u `app.invite_lookup_token`; `invitations` i
  `companies` politike zajedno vraćaju samo firmu tačne važeće pozivnice. Prihvatanje atomski
  claimuje token, postavlja `app.company_id` iz reda pozivnice, pa RLS dopušta INSERT identiteta i
  članstva unutar iste transakcije.
- **Reset/promjena lozinke:** reset se claimuje po tačnom tokenu; tenant uzima iz reset reda.
  Lozinka se ažurira samo za korisnika koji ima članstvo u tom tenant-u. Obična promjena lozinke
  već radi pod `withCompany` nakon provjere sesije/članstva.
- **Platform tokovi:** trenutno ne postoje u web kodu. `platform_users` ostaje bez direktnih app
  prava; budući tok ne smije se oslanjati na globalni SELECT kao prečicu.
- **Višefirmska izolacija:** direktan upit pod tenant A vidi samo users sa članstvom u A i samo
  `companies.id = A`; bez tenant/login/invitation konteksta ne vidi redove. To je pokriveno testom
  na pravom PostgreSQL-u. GUC je transaction-local, kao i u postojećim tenant pravilima.

## Migracija, preflight i testovi

`20261110120000_b_tenant_global_rls_privileges` je naprijed-samo i ne mijenja postojeće podatke.
`bootstrap/grants.sql` idempotentno opoziva stare privilegije pa daje samo prava iz matrice;
`roles.sql` više ne uvodi široke grants/default ACL-ove. Runtime i CI preflight učitavaju istu TSV
matricu, provjeravaju da su sve public tabele/sekvence inventarisane, svaki non-RLS objekat
obrazložen, sve `company_id` tabele zaštićene RLS-om/politikom, RLS na `users`/`companies`, te
odsustvo manjka i viška efektivnih table/column/sequence prava.

Integracijski testovi pokrivaju login, pregled/prihvatanje pozivnice, reset, promjenu lozinke,
negativne DELETE/UPDATE/SELECT privilegije i direktne users/companies upite pod dvije firme.
Migracija treba biti primijenjena i provjerena na praznoj i već popunjenoj lokalnoj kopiji prije
staginga; deployment na staging/produkciju i dalje zahtijeva vlasnikovu provjeru kroz `DATABASE_URL`.

## Rollback

Migracija ne briše ni prepisuje aplikacijske podatke. Uobičajeni rollback je kod/image rollback uz
sigurne ACL-ove; ne pokreći stari image sa starim `grants.sql` i `RUN_MIGRATIONS=true`, jer stari
bootstrap vraća široka prava. Kodna verzija prije B nema `app.auth_lookup_email`, pa joj za hitni
povratak treba privremeno onemogućiti samo RLS na `users` i vratiti samo SELECT na migracijski
ledger — nikad ponovo dodijeliti široki `GRANT ALL`:

```sql
BEGIN;
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.schema_migrations TO gradix_app;
COMMIT;
```

To je hitni, privremeni korak i ukida izolaciju globalnih users redova. Kada se vrati B-kompatibilan
kod, prije ponovnog starta aplikacije vrati zaštitu i ledger ACL:

```sql
BEGIN;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM gradix_app;
COMMIT;
```

Nemoj ručno brisati migracijski ledger ni vraćati stari široki ACL. Nakon bilo kakve ručne
intervencije pokreni novi runtime preflight; on mora pasti dok `users` RLS ili matrix ACL nisu
vraćeni.

# PLAN R1b — matrica rola, dodjela rola i opsega, audit trag

**Datum:** 2026-11-08 · **Status:** u radu · **Kapija:** G1b poslije ovog reza

## Šta ulazi (i šta ne)

| Ulazi | Ne ulazi |
|---|---|
| matrica rola kao **pregled** (koja rola šta smije) | uređivanje dozvola po roli |
| dodjela rola i opsega postojećoj osobi | kreiranje novih rola |
| audit trag sa filterima i detaljem zapisa | izvoz, retencija, brisanje traga |
| jedan izvor dozvola za UI i za rute | nova baza dozvola (ostaje `PERMISSIONS` u kodu) |

## Odluka o opsegu (vlasnik, 2026-11-08)

Opseg „dodijeljeni projekti“ **odlazi u R2**. U R1b:

- opseg ima **dvije** vrijednosti: `COMPANY` (cijela firma) i `SELF` (samo svoje),
- vrijednost `PROJECTS` i kolona `memberships.project_ids` se **brišu** migracijom —
  ništa što UI ne nudi ne ostaje u bazi ni u API-ju,
- provjera opsega ide kroz **jednu** funkciju `resolveScope(scope, action)` u `@gradix/domain`,
  sa testovima za oba slučaja; R2 dodaje treći slučaj u tu funkciju i svoju migraciju,
- u `PLAN-R2.md` stoji stavka „dodati opseg ‚dodijeljeni projekti‘“ sa onim što treba
  (tabela dodjela, FK na `projects` i `memberships`, vrijednost u CHECK-u, testovi, UI).

## Model

Migracija `20261108140000_r1b_role_i_opseg`:

1. `UPDATE memberships SET scope = 'COMPANY' WHERE scope = 'PROJECTS'` (niko nije ostavljen
   sa vrijednošću koja se gasi),
2. `ALTER TABLE memberships DROP CONSTRAINT memberships_scope_check`,
   `ADD CONSTRAINT memberships_scope_check CHECK (scope IN ('COMPANY','SELF'))`,
3. `ALTER TABLE memberships DROP COLUMN project_ids` — tenant tabela, RLS politika ostaje ista,
4. `audit_events`: indeks `(company_id, action, created_at DESC)` za filter po radnji i
   `(company_id, created_at DESC, id)` za keyset cursor (offset ne koristimo: trag raste).

RLS: nijedna nova tabela. `audit_events` već ima `tenant_isolation` politiku; čitanje ide
kroz `withCompany`, pa firma A ne vidi nijedan zapis firme B.

## API

```
PATCH /api/users/:id/membership   { roles: Role[], scope: "COMPANY"|"SELF" }
GET   /api/audit?cursor=&actorId=&action=&entityType=&from=&to=&limit=
GET   /api/audit/actions          (zatvoren spisak radnji za filter — bez hardkodiranja u UI)
GET   /api/roles                  (role + šta smiju + opisi za matricu; jedan izvor)
```

Zatvoreni kodovi greške se ne mijenjaju. Nova za ovaj rez: `USERS_TARGET_PROTECTED` (403)
kad bi izmjena ostavila firmu bez vlasnika ili kad akter nije vlasnik a dira vlasnika.

**Pravila dodjele** (servis, ne UI): akter mora imati `users.manage`; ne mijenja sopstvene
role; `OWNER` rolu daje i skida samo `OWNER`; posljednji `OWNER` u firmi se ne može skinuti;
najmanje jedna rola. Svaka izmjena piše `user.membership_changed` u **istoj** transakciji,
sa `metadata: { from: {roles, scope}, to: {roles, scope} }` — bez tajni.

**Efekat odmah:** `authenticate` čita role i opseg iz baze na svakom zahtjevu, pa izmjena
važi od sljedećeg zahtjeva; sesije se ne moraju gasiti (i ne gase se — gašenje bi bilo
kažnjavanje, a ne sigurnost).

## Ekrani

| Ekran | Stanja |
|---|---|
| `/ured/role` — matrica | učitavanje (skeleton), uspjeh (tabela rola × dozvola), prazno nije moguće (role su u kodu), greška + „Pokušaj ponovo“ |
| `/ured/korisnici` — izmjena | dijalog „Rola i opseg“: trenutno stanje, izbor rola (checkbox), opseg (radio), čuvanje, greška iz servisa prikazana u dijalogu, uspjeh u listi |
| `/ured/audit` — trag | učitavanje, prazno („nema zapisa za ovaj filter“), greška, uspjeh + „Učitaj još“ (keyset), detalj zapisa |

Pravila dizajna ostaju: web smjer A (tabela ≥ 640 px), kartice < 640 px, jedna kontekstualna
akcija u redu, primarno dugme puna širina samo ispod 640 px, dvije gustine, nijedna
hardkodirana boja, tastatura kroz cijeli tok (dijalog hvata fokus, `Escape` zatvara,
fokus se vraća na dugme koje ga je otvorilo).

## Testovi

1. **Tenant izolacija, generisano po tabeli** — test se gradi iz liste tenant tabela
   (`memberships`, `sessions`, `machines`, `audit_events`, `invitations`, `password_resets`,
   `sync_items`): firma A ne vidi ni jedan red firme B. Nova tabela se dodaje u listu, ne u
   novi test — pa ne može ostati nepokrivena.
2. **Dozvole po roli** — matrica rola × ruta, generisano iz `PERMISSIONS`: za svaku rolu i
   svaku dozvolu tačno jedan očekivan status (200/403). Test pada ako se `PERMISSIONS`
   promijeni a matrica u UI-u ne.
3. **Dodjela:** ADMIN ne dira OWNER-a, niko ne mijenja sebe, posljednji OWNER ostaje,
   promjena važi od sljedećeg zahtjeva bez ponovne prijave.
4. **Audit:** svaka izmjena = tačno jedan zapis; filteri vraćaju isto što i direktan upit;
   keyset cursor ne vraća isti zapis dvaput i ne preskače nijedan; `metadata` bez tajni.
5. **E2E glavnog toka** (HTTP, prava baza, bez preglednika): prijava → matrica → dodjela role
   → audit pokazuje izmjenu → nazad na staru rolu.

## Redoslijed rada

1. migracija + `resolveScope` + testovi opsega,
2. servis (`getRolesMatrix`, `changeMembership`, `listAudit`) + testovi dozvola i audita,
3. rute (`/api/roles`, `/api/users/:id/membership`, `/api/audit`),
4. ekrani (matrica, dijalog, audit) + sva stanja,
5. demo 360/1440 za sva stanja + `docs/DEMO-G1b.md`,
6. provjere: lint, typecheck, test, build, CI; pa kapija.

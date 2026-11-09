# ADR 0012 — najmanji opseg po zadanim postavkama i runtime preflight

**Status:** prihvaćeno (vlasnik, zatvaranje R3) · **Mijenja:** deploy-role dio ADR 0007; potvrđuje ne-vlasničku `DATABASE_URL` rolu

## Odluka

1. `memberships.scope` za **novi** red ima `DEFAULT 'SELF'`. Migracija mijenja samo DEFAULT —
   ne radi `UPDATE` i ne mijenja već odobrene opsege postojećih članova.
2. `invitations.scope` nema DB DEFAULT. API za pozivnicu i API za izmjenu/dodjelu role odbijaju
   zahtjev bez izričito poslanog `scope`; obrazac za pozivnicu nema unaprijed izabran opseg.
3. Kad je `RUN_MIGRATIONS=true`, entrypoint traži zasebni `DATABASE_ADMIN_URL` za migracije i ne
   koristi `DATABASE_URL` kao rezervnu administratorsku konekciju. Nakon migracija, prije starta
   web procesa, isti preflight se spaja kao `DATABASE_URL` i kritično pada ako aplikacijska rola
   jeste vlasnik tabele, superuser, ima `BYPASSRLS`, ili ako tabela sa `company_id` nema uključen
   RLS i barem jednu politiku. Provjerava i mehanizam preklapanja dodjela te `memberships.scope DEFAULT`.
4. CI pokreće istu skriptu istom vrstom konekcije (`gradix_app` iz `DATABASE_URL`), ne admin
   konekcijom. Redis i S3/MinIO provjere su informativne i nikad ne obaraju deploy.

## Zašto

Ostavljen `DEFAULT 'COMPANY'` tiho bi dao širi opseg kad se pozivalac zaboravi izjasniti. Brisanje
ili izmjena postojećih opsega u migraciji bi, s druge strane, promijenila prava bez vlasnikove
pojedinačne odluke. Odvojena aplikacijska rola je obavezna jer vlasnik i superuser mogu zaobići
RLS; zato se katalog provjerava baš kroz konekciju kojom aplikacija radi.

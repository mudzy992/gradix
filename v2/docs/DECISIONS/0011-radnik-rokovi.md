# ADR 0011 — Radnik vidi svoje rokove, ne i priloge

**Status:** prihvaćeno (2026-11-09, odluka vlasnika u pregledu G3)
**Kontekst:** `WORKER` nije imao `obligations.view`, pa mu je mobilni ekran „Moji rokovi" vraćao 403

## Odluka

1. **`WORKER` (i `DRIVER`) dobija `obligations.view`** — isključivo u opsegu `SELF`.
2. **Opseg `SELF` nameće server**, iz sesije: obaveze gdje je osoba odgovorna ili je vezana za
   radnika na tom nalogu. Tuđe ne vidi ni uz `?workerId=`.
3. **Prilozi su posebna dozvola** `obligations.attachments.view` (OWNER, ADMIN, PROJECT_MANAGER,
   SITE_SUPERVISOR, ACCOUNTANT). Radnik vidi **tip, rok i stanje** — ne i sken.
4. **Ruta koja otvara sadržaj priloga** traži tu dozvolu, ne `obligations.view`.
5. **Tuđi rok je 404, ne 403** — radnik ne treba da zna da tuđi rok postoji.

## Zašto ne „radnik ne vidi rokove"

Ekran „Moji rokovi" postoji zbog radnika: njemu ljekarski istječe, on ide na pregled. Ako on ne vidi
rok, ekran služi samo uredu — a ured ima svoj spisak. Dozvola je zato data, ali sa granicom.

## Zašto prilozi NISU uz `obligations.view`

Ljekarski nalaz je **lični podatak** (`poslovna tajna` i zaštita privatnosti, vidi `check-privacy`).
Radnik ima pravo znati *da mu rok istječe*; nema pravo da sken visi na telefonu koji stoji na stolu
u kontejneru. Zato dvije dozvole:

- `obligations.view` — „vidi da postoji i do kada važi",
- `obligations.attachments.view` — „otvori dokument".

Bez druge, servis **ne izvršava ni upit** za priloge u listi (`includeAttachments: false`). Nije
sakriveno u prikazu — podatak ne dolazi iz baze. Tako ga nije moguće „zaboraviti" ukloniti.

## Zamka koju treba znati

U R1a je `memberships.scope` dobio `DEFAULT 'COMPANY'`, pa dozvola **sama po sebi ne ograničava
redove** — granicu drži opseg. Zatvaranjem R3, DEFAULT za nove članove je promijenjen na `SELF`
bez izmjene postojećih redova. Postojeći radnik sa `obligations.view` i istorijskim opsegom
`COMPANY` i dalje bi vidio cijelu firmu; zato se postojeći opseg ne mijenja automatski i zato:

- testovi radnicima **eksplicitno** postavljaju `scope = 'SELF'`,
- opseg dolazi iz sesije (`AuthContext`), nikad iz zahtjeva,
- `listObligations` primjenjuje opseg **prije** korisničkih filtera — granica primijenjena poslije
  filtera nije granica.

## Posljedice

- `listObligations` i `getObligation` dobijaju `options { scope, userId, includeAttachments }`.
- Mobilni ekran „Rokovi" sada radi za radnika; prikazuje tip, rok i stanje (i ranije je samo to).
- Ruta `…/attachments/{id}/url` traži `obligations.attachments.view`.
- `permissionsFor("WORKER")` = `["obligations.view", "projects.view"]` — test to tvrdi cijelim nizom
  da tiho dodana dozvola ne prođe neprimijećeno.

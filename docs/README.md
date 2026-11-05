# Gradix — dokumentacija

> **Jedini izvor istine** za implementaciju su `docs/` i `AUDIT/`. Sve starije je penzionisano
> u [`_retired/`](./_retired/INDEX.md) i služi samo kao historijska referenca.

| Dokument | Šta pokriva | Kada ga čitati |
|---|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | kontekst, komponente, slojevi, glosar, tokovi, deployment topologija | prvi dan na projektu |
| [`INFRASTRUCTURE.md`](./INFRASTRUCTURE.md) | Docker/Coolify, mreže, host mount-ovi, env katalog, migracije, seed, backup | prije svakog deploya |
| [`BACKEND.md`](./BACKEND.md) | moduli, API ugovor, guardovi, poslovna pravila, dugovi | pri radu na API-ju |
| [`FRONTEND.md`](./FRONTEND.md) | rute, state, i18n, design tokeni, WCAG 2.2 AA, dugovi | pri radu na webu |
| [`MOBILE.md`](./MOBILE.md) | Expo, navigacija, offline sync, sigurnost, testovi | pri radu na mobilnoj |
| [`TESTING.md`](./TESTING.md) | piramida, pragovi pokrivenosti, gdje testovi žive | prije pisanja testova |
| [`CI.md`](./CI.md) | jobovi, okidači, guardovi, troubleshooting | pri svakom pushu |
| [`CONVENTIONS.md`](./CONVENTIONS.md) | imenovanje, veličine, commit format, guardrail skripte | prije prvog commita |
| [`DECISIONS.md`](./DECISIONS.md) | odluke vlasnika (D-001…), zamijenjene odluke | kad nešto „treba promijeniti“ |
| [`design/FE-01-palette-proposals.md`](./design/FE-01-palette-proposals.md) | tri seta tokena (A „Gradix Green“ / B „Slate / Teal“ / **C kombinacija — primijenjeno**, D-040) sa izmjerenim kontrastima | pri izboru ili izmjeni vizuelnog identiteta |
| [`design/FE-04-dashboard-ia.md`](./design/FE-04-dashboard-ia.md) | informaciona arhitektura dashboarda: zone, grid, stanja, šta svjesno **ne** prikazuje (D-043) | pri izmjeni dashboarda ili dodavanju novih ekrana |
| [`design/FE-17-dashboard-v2.md`](./design/FE-17-dashboard-v2.md) | dashboard v2: B0, podatkovni ugovor i admin K2 checkpoint | tokom BE-19/FE-17 |
| [`_retired/INDEX.md`](./_retired/INDEX.md) | šta je penzionisano i zašto | samo za historijski kontekst |
| [`../AUDIT/STATE.md`](../AUDIT/STATE.md) | dnevnik rada: gdje smo stali, zadnji CI run | početak svake sesije |

**Pravilo:** ako dokument i kod nisu saglasni, to je **bug u dokumentaciji ili u kodu** — prijavi
ga, ne biraj sam. Promjena vidljivog ponašanja traži odobrenje vlasnika (`DECISIONS.md`).

# Izvještaj G0 — Faza 0

**Datum:** 2026-11-27 · **Grana:** `arena/7b5ea9bf-gradix` · **Pregledani kodni commit:** `e7a37910a9c0a651d3d77a059592d755330b399c`

**Kapija:** G0 artefakti predani na pregled. Nakon ovog izvještaja stajem; ne počinjem Fazu 1 ni audit modula dok vlasnik ne potvrdi G0.

## Predano

- [`PRAVILA.md`](PRAVILA.md) — pravila, invarijante, dokazni standard, težina, scope guard, redoslijed, šabloni i kapije.
- [`INVENTAR.md`](INVENTAR.md) — provjereni web/API/server/domain/DB/worker/test inventar po 12 modula, presjeci i dokumentacijsko-kodna neslaganja.
- [`0018-audit-program.md`](0018-audit-program.md), [`STATE.md`](STATE.md) i jedna uputna linija u `v2/AGENTS.md`.
- Nije mijenjan poslovni kod. Testovi, typecheck, lint, quality checker, build, DB preflight, deploy i pilot provjera nisu pokretani.

## Šta je odudaralo od početne mape

1. Rute koje su u nalogu ostavljene kao primjeri dobile su eksplicitno vlasništvo: `/ured/akcije` pripada modulu 12; `/ured/uvoz` je UX modula 6, ali uvozna vrsta prelazi granice modula 4/5/6 (`workers`, `equipment`, `projects`); `/nemate-pristup` je modul 1 route handler (`route.ts`), ne stranica; kalendari mašina/tendera su u 5/8, a `/ured/dijelovi` u 9. Partneri imaju vlastitu stranicu i F10 API/tabele u 11.
2. **F10:** nalog vlasnika kaže da je isporučena na `pilot-ready`; `v2/docs/STATUS.md` kaže „Faza 10 — početak (nije isporučena)“. Na aktivnoj grani postoje F10 migracije, rute, servisi i testni fajlovi. To potvrđuje prisutnost koda, ne prolaz testova, primjenu migracija, deploy ili pregled vlasnika uživo. Remote `pilot-ready` ref nije pronađen (`git ls-remote --heads origin pilot-ready` bez refa; GitHub branch API vratio 404), pa tu tvrdnju nisam mogao provjeriti.
3. **C.1 pregled:** `v2/docs/design/DESIGN.md` označava rješenje kao prijedlog koji čeka vlasnika, dok `v2/docs/design/reference.html` kaže „Odobreno 2026-11-12 · implementirano“; postoje `/pregled` UI i servis. Ne proglašavam nijednu stranu konačnom bez vlasnikove potvrde.
4. **Tenderi:** `STATUS.md`/izvještaj Faze 7 navode `tender_calculation_items` i `tender_price_approvals`, kojih nema u trenutno generisanoj šemi/migraciji. `tender_attachments` postoji u historijskoj migraciji/dokumentima; trenutni kod koristi objedinjene priloge. Ovo su stvari za razjašnjenje, ne potvrđene greške.
5. **Hronologija:** u snimku od 2026-11-27 postoje migracije datirane od 2026-11-28 do 2026-12-01. Zabilježeno je bez zaključka da su pogrešne. `STATUS.md` ima 544 linije naspram pravila ≤100; nisam ga mijenjao u G0.

## Prvi rizici za kasniji audit — hipoteze, ne nalazi

- Provjeriti PROJECTS-scope listi servisnih naloga, kvarova i dnevnika; raniji F11 izvještaj upozorava na ograničenje opsega. Nije potvrđeno kao kvar ovim inventarom.
- Dokazati da nabavni račun i izlaz materijala ne knjiže isti trošak dvaput u `cost_entries`.
- Razriješiti drift oko F10 statusa, C.1 odobrenja i tender tabela prije nego se dokumenti koriste kao dokaz „gotovosti“.
- Uporediti podsjetnike iz spec 12 s `reminders-scan.ts`: specifikacija navodi HSE mjere i tenderske garancije, dok ta datoteka obrađuje obaveze i održavanje; ovo traži ciljanu provjeru u modulima 10/12.
- Ne poistovjećivati postojeći test/CI s pilotom: u ovom G0 nisu pokrenuti testovi, a nema dokaza o deployu ili pregledu vlasnika uživo.

## Dizajnerska preferencija i pitanja vlasniku

Zabilježeno je da se korisniku sviđaju kartica Pregleda, njen sadržaj i koncept osmišljavanja. To je preferencija za kasniji audit, ne odobrenje za izmjenu `/pregled`. Mobilne preglede iz primjera zasad zanemarujemo.

1. Koju ref treba uzeti kao stvarno „pilot-ready“ za F10 (ili je aktivna grana jedina referenca za nastavak)? Molim potvrdite i F10 status: kod na aktivnoj grani se može inventarisati, ali deployment/pilot review ostaje nepoznat.
2. Koji je status vlasnikovog odobrenja C.1: „čeka odobrenje“ u `DESIGN.md` ili datum odobrenja iz `reference.html`?
3. Jesu li migracije datirane poslije 2026-11-27 očekivani sadržaj ove grane/snimka, i koji datum treba koristiti kao referentni?

**Sljedeći korak:** čekam potvrdu G0 ili tražene ispravke. Ne otvaram audit modula i ne diram poslovni kod prije vlasnikove potvrde i zasebne fraze za kodiranje modula.

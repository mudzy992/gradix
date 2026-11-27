# AUDIT B5.3 — R7 vs MASTER_BRIEF (gap mapa)

Datum: 2026-11-20 · Opseg: **audit only** (bez feature builda predmjera/garancija/checklistе).
Izvor: `MASTER_BRIEF.md` §B5.3 + Partneri; isporuka R7 (`tenders` MATRIX, 1-C + 2-B).

Legenda: **da** = pokriveno u R7 · **djelimično** = dio · **ne** = backlog / van R7 · **dug** = eksplicitno van obima R7.

## B5.3 Tenderi

| Zahtjev (MASTER_BRIEF) | R7 | Napomena |
|---|---|---|
| Evidencija: naručilac, predmet, vrijednost, status | **da** | partner CLIENT, title, money cents, status |
| Izvor/portal | **ne** | nije u šemi |
| Rok za dostavu / rok za pitanja | **ne** | nije u šemi; rokovi preko obligations TENDER (opšte) |
| Tok `Prilika→…→Predano→…` (puni B5.3) | **djelimično** | R7: `DRAFT→SUBMITTED→WON\|LOST\|WITHDRAWN` (bez Prilika/Odluka/Priprema/Ocjenjivanje/Poništeno) |
| Eksplicitna pravila prelaza (bez preskakanja) | **da** | MATRIX status tabela + service |
| Tenderska dokumentacija / kontrolna lista | **dug** | van R7; prilozi = generički upload, ne checklista |
| Garancije (ponudbena, izvršenje) | **dug** | van R7 |
| Kalkulacija / predmjer / jedinične cijene | **dug** | van R7; v2 backlog |
| Kopiranje iz sličnog tendera | **ne** | |
| Ishod: razlog gubitka, cijena pobjednika | **djelimično** | `note` slobodan tekst; nema strukturiranih polja |
| Konverzija WON→projekat (atomski) | **da** | bez kopiranja predmjera/priloga/tima (nema ih u R7) |
| Kalendar rokova 14/7/3/1 | **djelimično** | obligations TENDER + Rokovi filter; nema tender-specifičnih pragova |
| Izvještaj uspješnosti / vrijednost u toku | **dug** | van R7 |

## Partneri (MASTER_BRIEF + R7.1)

| Zahtjev | R7 | Napomena |
|---|---|---|
| Jedan model partner s ulogama (naručilac/dobavljač/…) | **da** | `kind`: CLIENT\|VENDOR\|SERVICE\|OTHER |
| UI lista + CRUD/deactivate | **da** | `/ured/partneri` |
| FK naručilac na tenderu | **da** | |

## R7 1-C / 2-B (isporučeno)

| Stavka | Status |
|---|---|
| Statusi + prelazi + dozvole | **da** |
| Prilozi register→MinIO→confirm | **da** (runtime MinIO) |
| Obligations × TENDER | **da** |
| Convert WON | **da** |
| Partneri CLIENT + UI | **da** |

## Zaključak

R7 pokriva **operativni 1-C tok** (evidencija, statusi, convert, partneri, prilozi, TENDER obligations).
Puni B5.3 tender (predmjer, garancije, checklista, izvještaji, prošireni statusi) ostaje **gap / dug** — ne implementirati u ovom planu.

# CI-05 ledger — radna evidencija

Obuhvat: svih 72 nalaza iz [izvještaja CI-05](segments/CI-05.md#5-nalazi); izvorni zapis i dokazi nisu brisani. Ovo je **radni prijepis**, ne konačna trijaža: historijski opisi mogu biti zamijenjeni kasnijim izmjenama. Testovi i njihovi rezultati nalaze se i u [§7 izvještaja](segments/CI-05.md#7-testovi). Za commit koji nije eksplicitno povezan s nalazom u dostupnom lokalnom Git stablu stoji „nije još utvrđen“, ne izmišljeni SHA. Ograničenja se moraju razlučiti u [backlogu](BACKLOG.md) prije zatvaranja.

## F-CI-05-01

- **Težina:** visoko. **Status:** otvoreno — gate u obradi. **Commit:** nije još utvrđen.
- **Scenarij:** `done` segmenti imaju nepregledane fajlove, a postojeći gate to ne prijavljuje
- **Modul/dokaz:** `scripts/audit/check-coverage.mjs` §6; `AUDIT/COVERAGE_MATRIX.csv`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Stvarno pregledati dug, ne uvoditi izuzetke; zatim integrisati i regresijski testirati strogi gate

## F-CI-05-02

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** `parseIsoDateTime` je normalizovao npr. `2026-02-31T10:30:00Z` u mart i prihvatao pogrešan rok dokumenta/tendera
- **Modul/dokaz:** `backend/src/common/utils/date-input.ts`; `date-input.spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Provjera kalendarskog dijela prije vremena; regresijski test sa vremenskom zonom

## F-CI-05-03

- **Težina:** srednje. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** `parseOptionalDate` za projekat/zadatak/fazu također normalizuje nepostojeći kalendarski datum
- **Modul/dokaz:** `backend/src/common/scope/ops-dates.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** ISO prefiks provjeriti prije `Date` normalizacije; regresijski testovi; ostali prihvaćeni formati ostaju nepromijenjeni

## F-CI-05-04

- **Težina:** srednje. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Lista obavijesti je tokom učitavanja ili greške prikazivala „Nema obavijesti“
- **Modul/dokaz:** `frontend/src/components/notifications/bell.tsx`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Posebna stanja status/alert i ponovni pokušaj; dva regresijska testa

## F-CI-05-05

- **Težina:** srednje. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Gantt prikazuje samo dekorativne trake bez tekstualnih datuma; nevažeći i obrnuti rasponi remete skalu, a jednodnevna traka prelazi rub
- **Modul/dokaz:** `frontend/src/components/ops/planned-gantt.tsx`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Datumi u tekstu i `time`, validacija i odbacivanje neispravnih raspona, ograničena širina; regresijski testovi

## F-CI-05-06

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Količine se kreiraju uvijek kao M3, iako šema podržava šest jedinica; polja i redovi nisu imali potpune pristupačne nazive, neuspjelo spremanje je ostavljalo pogrešan prikaz
- **Modul/dokaz:** `frontend/src/components/ops/quantities-tab.tsx`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Izbor jedinice, prevedeni nazivi, imenovana tabela i polja, status/ponovni pokušaj, vraćanje neuspjele izmjene; 4 testa

## F-CI-05-07

- **Težina:** srednje. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Duplikat fajla u matrici prepisivan je u `Map`, pa sam `check-coverage` nije otkrivao dupli red; oštećeni redovi nisu eksplicitno validirani
- **Modul/dokaz:** `scripts/audit/check-coverage.mjs`, `scripts/audit/lib.mjs`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Provjera prije `readMatrix`; node:test izolovani workspace, testovi u CI

## F-CI-05-08

- **Težina:** srednje. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Dispatch je skrivao obavezne greške i neuspješno učitavanje projekata/korisnika; submit nije bio blokiran tokom zahtjeva
- **Modul/dokaz:** `frontend/src/components/ops/dispatch-sheet.tsx`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Povezane greške, retry, projekti obavezni, korisnici opcioni, submit blokiran do kraja zahtjeva; četiri testa

## F-CI-05-09

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Projektni dnevnik bez oznaka polja ili stanja greške; neuspjeli upis problema ostaje kao da je spremljen; UTC određuje početni datum i mjesec umjesto zone firme
- **Modul/dokaz:** `frontend/src/components/ops/project-diary-tab.tsx`, `frontend/src/pages/diary-page.tsx`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Pristupačne oznake, retry i rollback, sprečavanje duplog upisa, datum/mjesec po zoni firme; regresijski testovi

## F-CI-05-10

- **Težina:** srednje. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Prazni planirani datumi pri izmjeni projekta nisu slani na backend, pa ih nije bilo moguće obrisati; naziv nije imao vidljivu validaciju
- **Modul/dokaz:** `frontend/src/components/ops/project-sheet.tsx`, `backend/src/modules/ops/projects.service.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Na PATCH poslati prazan string za brisanje datuma; povezati validaciju naziva i spriječiti dupli submit; tri testa

## F-CI-05-11

- **Težina:** srednje. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Kod, lokacija, naručilac i budžet imaju isti obrazac izostavljanja praznih vrijednosti; brisanje nije usklađeno sa backend PATCH obradom
- **Modul/dokaz:** `frontend/src/components/ops/project-sheet.tsx`; `backend/src/modules/ops/projects.service.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** PATCH prazno/null briše; izostavljeno ostaje; frontend šalje samo izmijenjena opciona polja, uz regresijske FE i backend E2E testove

## F-CI-05-12

- **Težina:** srednje. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Cover projekta moguće je ponovo poslati tokom uploada; nakon greške ponovni izbor istog fajla ne pokreće upload
- **Modul/dokaz:** `frontend/src/components/ops/project-public-card.tsx`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Blokada paralelnog uploada, status i reset inputa; tri regresijska testa

## F-CI-05-13

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Kartice unaprijed učitavaju sve podatke, ne razlikuju prazno/grešku i uklanjanje člana odbija bez obrade; sirovi enumi i neoznačene kontrole
- **Modul/dokaz:** `frontend/src/components/ops/project-tabs.tsx`, `frontend/src/pages/project-detail-page.tsx`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Aktivni tab/prava, stanja i retry, prevodi, obrada grešaka i blokada mutacija; 11 testova

## F-CI-05-14

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Zadaci, flota, ture i gorivo učitavaju samo prvu stranicu; Gantt zadataka također samo prvih 100
- **Modul/dokaz:** `frontend/src/components/ops/project-tabs.tsx`, `frontend/src/pages/project-detail-page.tsx`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Riješeno: stranice za sve četiri liste; Gantt eksplicitno prikazuje zadatke odabrane stranice uz sve faze; povratak i nakon greške

## F-CI-05-15

- **Težina:** srednje. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Upload dokumenta i povezivanje sa projektom su dva poziva; ako drugi padne, upload može ostati bez projektne veze
- **Modul/dokaz:** `frontend/src/components/ops/project-tabs.tsx`, `backend/src/modules/files/files.service.ts`, `backend/src/modules/ops/documents.service.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: nakon potvrđenog uploada frontend čuva UUID i referencu u memoriji; server jedinstvenim indeksom štiti paralelno/retry povezivanje s istim ključem, odbija drugi payload i ne otkriva ključ u odgovoru. Ostaje otvoreno zbog refresha/zatvaranja taba, izgubljenog odgovora samog uploada, ranije obrisanih veza i starih klijenata bez ključa; replay s ključem poslije novog brisanja djelimično ublažava F-CI-05-49; MinIO i DB nisu atomski. Cleanup ne smije uklanjati objekat koji je druga operacija već povezala

## F-CI-05-16

- **Težina:** srednje. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Dodavanje člana uvijek šalje ulogu WORKER i lista korisnika uključuje neaktivne/već dodijeljene
- **Modul/dokaz:** `frontend/src/components/ops/project-tabs.tsx`, `backend/src/modules/ops/assignments.service.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Odabir svih pet projektnih uloga, filtriranje neaktivnih i dodijeljenih korisnika, pretraga i stranice; dva dodatna testa

## F-CI-05-17

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Poređenje backup/restore redova moglo je uporediti iste SQL greške kao jednak rezultat, a nebrojčan broj migracija nije pouzdano padao
- **Modul/dokaz:** `.github/workflows/backup-restore.yml`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Fail-fast SQL/pipeline, validacija brojeva, tačan broj migracija; četiri regresijska testa stvarnog shell koraka u audit CI

## F-CI-05-18

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Inventar je mogao odbaciti stale redove ili duplikate i prepisati neispravan status; `scaffold --force` uništava izvještaje
- **Modul/dokaz:** `scripts/audit/inventory.mjs`, `scripts/audit/scaffold-segments.mjs`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Validacija prije pisanja, stale/unknown bez upisa, atomarna zamjena i zabrana `--force`; 6 izolovanih testova u CI

## F-CI-05-19

- **Težina:** srednje. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Promjena kartice projekta zamjenjivala je cijeli query string i gubila nepovezane, uključujući ponovljene parametre
- **Modul/dokaz:** `frontend/src/pages/project-detail-page.tsx`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Izmijeniti samo `tab` u kopiji postojećih parametara; regresijski test s ponovljenim vrijednostima

## F-CI-05-20

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Env guard je deklaraciju tipa smatrao potvrdom runtime validacije, ignorisao nedostajući Coolify predložak i statičke bracket / double-quote pristupe
- **Modul/dokaz:** `scripts/standards/check-env.mjs`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Nedostajući predlošci i validator ruše provjeru; prepoznaju se oba navodnika i statički bracket pristupi; traži se eksplicitni `raw.NAME` u validatoru. I dalje je regex heuristika, ne dokaz stvarne validacije ni analiza dinamičkih pristupa; pet izolovanih testova

## F-CI-05-21

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Prototip strogog gatea prihvatao je aktivnu granu bilo gdje u tekstu workflowa, čak i u komentaru, a nedostajuća grana bila je samo upozorenje
- **Modul/dokaz:** `scripts/audit/check-audit-gate.mjs`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Provjera stvarnog `on.push.branches` bloka, bez globova, samo push aktivne grane i dispatch, te obavezna grana iz STATE; šest izolovanih regresijskih testova. Parser namjerno prihvata samo trenutni jednostavni block-format; ostale invarijante i gate ostaju u pregledu

## F-CI-05-22

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Prototip je prihvatao svaki `if` koji počinje sa `!inputs.suite`, uključujući pogrešan suite i `|| true`; timeout 0 je prolazio
- **Modul/dokaz:** `scripts/audit/check-audit-gate.mjs`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Eksplicitna matrica šest poslova i tačni selektori, pozitivan timeout, doslovno poređenje koje ne briše razmake unutar stringova, testovi negativnih slučajeva. Nije opšti YAML parser; promjena workflow formata zahtijeva ažuriranje provjere

## F-CI-05-23

- **Težina:** srednje. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** CI-01 je uz aktivnu granu dozvoljavao i `main` push, suprotno pravilu vlasnika samo za aktivnu granu
- **Modul/dokaz:** `.github/workflows/ci.yml`, `docs/CI.md`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Uklonjen `main` iz push filtera; dispatch zadržan; dokumentacija i regresijski test u istom commitu

## F-CI-05-24

- **Težina:** nisko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Registar zadržao početne opise da ne postoje logging, backup i FE testovi, iako su implementirani; dokumentacija navodila sedam migracija nakon dodavanja osme
- **Modul/dokaz:** `scripts/audit/segments.json`, `docs/INFRASTRUCTURE.md`, `docs/ARCHITECTURE.md`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Ažurirani opisi i pregled migracija. Statusi segmenata ostaju nepromijenjeni; `done` nije dokaz da su svi novododani fajlovi pregledani

## F-CI-05-25

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Strogi prototip je čitao matricu kroz `Map` bez vlastite provjere integriteta pa je mogao previdjeti duplikat ili izostavljen fajl
- **Modul/dokaz:** `scripts/audit/check-audit-gate.mjs`, `scripts/audit/lib.mjs`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Prvo pokreće postojeći `check-coverage` i pada ako on ne prođe; izolovane regresije duplikata, stale/nedostajućeg fajla, oštećenog reda i neispravnog registra; prototip ostaje van CI gatea

## F-CI-05-26

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Oštećeno citiranje CSV reda moglo je imati osam kolona i proći coverage gate, dok se inventar nije mogao sigurno osvježiti
- **Modul/dokaz:** `scripts/audit/check-coverage.mjs`, `scripts/audit/lib.mjs`, `scripts/audit/inventory.mjs`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Zajednička jednolinijska CSV validacija, i za header; test ispravnih navodnika i tri oblika greške, očuvanja matrice i pada strogog prototipa

## F-CI-05-27

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Odgovor starog refresh-a mogao je nakon odjave/prijave prepisati ili obrisati novu sesiju; stari zahtjev se mogao ponoviti s drugim korisnikom/firmom ili vratiti podatke nakon promjene konteksta
- **Modul/dokaz:** `frontend/src/lib/api-client.ts`, `frontend/src/lib/storage.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Generacija prijave/odjave, provjera tokena prije primjene refresh-a, single-flight po sesiji/tokenu i provjera korisnika/firme na odgovoru i retryju; 10 novih regresijskih slučajeva. Već primljena serverska mutacija se ne poništava; međutabni F-FE-06-06 ostaje otvoren

## F-CI-05-28

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Istovremeni refresh istog tokena mogao je dva puta proći provjeru i izdati dva aktivna nasljednika
- **Modul/dokaz:** `backend/src/modules/auth/auth-tokens.service.ts`, `backend/test/auth.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Uslovni opoziv i kreiranje zamjene u transakciji; gubitnik prijavljuje reuse i opoziva sesije. E2E dva istovremena zahtjeva i provjera da pobjednički token ne ostaje aktivan; test ne nameće tačan raspored. Međutabna koordinacija i serijalizacija svih logout-all/login/rotacija različitih tokena ostaju otvorene

## F-CI-05-29

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Kartica može poslati stari token nakon konkurentne rotacije ili preuzeti token druge prijave iz zajedničkog storage-a
- **Modul/dokaz:** `frontend/src/lib/api-client.ts`, `frontend/src/lib/storage.ts`, `frontend/e2e/login.spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: Web Locks za zapamćeni token u kooperativnim tabovima; tab ne usvaja promijenjeni token u istoj sesiji. Testovi provjeravaju promjenu naloga i kontrolisano čekanje; bez Web Locks, u starim tabovima, pri kloniranom sessionStorage i nakon izgubljenog odgovora ostaje otvoreno. Gubitnik pri bootstrap-u ostaje na loginu, a reload pokreće novi bootstrap

## F-CI-05-30

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Uspješno čitanje praznog storage-a vraćalo je lokalno keširan token koji je drugi tab obrisao; neuspjelo brisanje moglo ga je vratiti
- **Modul/dokaz:** `frontend/src/lib/storage.ts`, `frontend/src/lib/storage.spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Prazan dostupni storage je mjerodavan; fallback/tombstone samo za neuspjele lokalne operacije. Blokirana pohrana ne omogućava pouzdanu međutabnu sinhronizaciju

## F-CI-05-31

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Globalni logout broadcast odjavljuje nepovezani korisnički nalog; odgođeni događaj može stići poslije nove prijave
- **Modul/dokaz:** `frontend/src/hooks/use-logout-sync.ts`, `frontend/src/lib/storage.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: verzionirani signal s ID korisnika i nonce; samo isti korisnik, ignorisanje posljednjeg signala koji je postojao pri usvajanju sesije. Legacy signali se ignorišu jer nemaju identitet; stari klijenti i dalje sve tretiraju globalno. Više starih događaja istog korisnika i bootstrap bez poznatog userId ostaju otvoreni

## F-CI-05-32

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Odjava je mogla poslati ili obrisati token drugog naloga iz dijeljenog storage-a; zakašnjeli odgovor odjave briše noviju prijavu
- **Modul/dokaz:** `frontend/src/components/layout/user-menu.tsx`, `frontend/src/pages/change-password-page.tsx`, `frontend/src/lib/storage.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Šalje se token vezan za tab; shared token se briše samo kad odgovara vezanom; odjava provjerava generaciju/korisnika poslije await-a. Compare/delete nije atomski; server može obraditi raniji zahtjev, a neuspjela odjava ne dokazuje opoziv. E2E tri kartice, unit regresije

## F-CI-05-33

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** `revokeAll` je mogao propustiti token nastao u paralelnoj rotaciji; prijava prethodno provjerenom lozinkom mogla je završiti poslije promjene naloga
- **Modul/dokaz:** `backend/src/modules/auth/auth-tokens.service.ts`, `backend/src/modules/auth/auth.service.ts`, `backend/test/auth.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: zajednički PostgreSQL row lock po korisniku za izdavanje/rotaciju/opoziv, provjera stanja poslije locka, reuse/opoziv u jednoj transakciji; kontrolisani DB E2E za rotaciju i promjene prije izdavanja. Razlog refaktora: bez zajedničkog locka različiti snapshotovi propuštaju novi token; nema nove zavisnosti ni migracije. Promjena naloga i naknadni opoziv nisu atomski; access JWT, pojedinačni logout starog tokena (djelimično ublaženo F-CI-05-35) i stari serveri ostaju ograničenja

## F-CI-05-34

- **Težina:** kritično. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Backend E2E reporter ignorisao je izlaz Jest procesa i kvar suitea bez pojedinačnih palih testova, pa CI može biti lažno zelen
- **Modul/dokaz:** `.github/workflows/ci.yml`, `scripts/audit/report-e2e.mjs`, `scripts/audit/report-e2e.test.mjs`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Fail-closed proces + JSON status i brojači + provjera suite/test statusa i nepraznog izvještaja. Izdvojeni mali Node helper opravdan izolovanim fixture regresijama, bez novih zavisnosti; ne ispisuje proizvoljne testne poruke u anotacije. Prije popravke GitHub zeleno nije dovoljno za dokaz E2E suitea

## F-CI-05-35

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Pojedinačni logout starog refresh tokena propuštao je njegove rotirane nasljednike
- **Modul/dokaz:** `backend/src/modules/auth/auth-tokens.service.ts`, `backend/prisma/schema/foundation.prisma`, migracija `20261104150000_refresh_token_family`, `backend/test/auth.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: nullable ID porodice, novi tokeni i rotacija čuvaju vezu; logout opoziva istu porodicu samo vlasnika, pod postojećim user lockom. Migracija je potrebna jer se hashirani tokeni bez dodatne veze ne mogu povezati; postojeći redovi se ne mijenjaju i aktivni legacy token dobija vezu na prvoj rotaciji. E2E testira potomke, drugu sesiju, tuđi token, legacy i kontrolisanu konkurentnu rotaciju. Već rotirani legacy token bez veze, obrisani preci, stari serveri, JWT i account/revokeAll atomski razmak ostaju ograničenja; reuse i dalje opoziva sve. Bez novih zavisnosti

## F-CI-05-36

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Promjena/reset lozinke i opoziv sesija bili su odvojeni; istovremene promjene mogle su koristiti istu staru lozinku
- **Modul/dokaz:** `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/auth-tokens.service.ts`, `backend/src/modules/users/users.service.ts`, auth/users E2E. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Hash i opoziv su jedna transakcija pod user lockom; korisnička promjena provjerava ranije potvrđeni hash poslije locka, admin reset atomizovan. Opravdanje ograničenog refaktora: bez istog commita pad ili paralelna rotacija ostavljaju sesiju poslije promjene lozinke; bez nove migracije ili zavisnosti. DB regresije: rollback na grešku opoziva, konkurentne promjene i blokirana rotacija, te reset. Tada su deaktivacije i provjera prava reseta ostajale neatomarne; naknadne dopune F-CI-05-37/39/40 ublažavaju te nalaze, access JWT vrijedi do isteka

## F-CI-05-37

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Deaktivacija korisnika i opoziv sesija bili su odvojeni, a greška zatvaranja timera mogla je preskočiti opoziv
- **Modul/dokaz:** `backend/src/modules/users/users.service.ts`, `backend/src/modules/auth/auth-tokens.service.ts`, `backend/test/auth.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Deaktivacija i opoziv su jedna transakcija s postojećim user lockom; i ponovljena deaktivacija opoziva sve. Patch ponovo provjerava tenant i ciljne role pod lockom; testirani DB rollback na grešku opoziva, konkurentna rotacija i greška/ponovni pokušaj zatvaranja timera. Ograničeni refaktor potreban radi atomskog sigurnosnog stanja, bez migracije i novih zavisnosti. Audit i timer su poslije commita (moguć prekid ili utrka s reaktivacijom); provjera promjene uloga uključujući last-SUPER_ADMIN nije cijela serijalizovana. Firma, JWT i stari serveri ostaju ograničenja

## F-CI-05-38

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Neuspješno zatvaranje timera pri deaktivaciji firme prethodno je preskakalo opoziv sesija; ponovljena deaktivacija nije pokušavala opoziv
- **Modul/dokaz:** `backend/src/modules/companies/companies.service.ts`, `backend/test/tenant.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: nakon upisa statusa opoziv ide prije timera; ponovljeni `isActive=false` ponovo pokušava opoziv i timer. Testovi simuliraju pad timer servisa i pojedinačnog opoziva te retry. Tada nije bilo atomski; F-CI-05-39 uvodi transakciju i koordinaciju firmom za kooperativne servere. Cjelovit protokol mora koordinisati firmu, izdavanje tokena i kreiranje korisnika uz konzistentan red lockova; nije implementiran ovom izmjenom. Audit i timer su zasebni, bez nove zavisnosti/migracije

## F-CI-05-39

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Status firme i opoziv njenih sesija bili su neatomarni i trkali su se s izdavanjem ili rotacijom
- **Modul/dokaz:** `backend/src/modules/companies/companies.service.ts`, `backend/src/modules/auth/auth-tokens.service.ts`, `backend/test/tenant.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Status i bulk opoziv su jedna transakcija s ekskluzivnim lockom firme; izdavanje/rotacija uzimaju dijeljeni lock firme pa user lock, te ponovo provjeravaju status i vlasništvo. Testovi: rollback na pad opoziva, rotacija prije deaktivacije, izdavanje i FK insert za vrijeme deaktivacije, izolacija druge firme. Opravdanje refaktora: bez zajedničkog locka token može nastati nakon snapshot-a bulk opoziva; nema migracije ni novih zavisnosti. Timer/audit ostaju nakon commita, miješane stare verzije i vanjski DB pisci ne slijede protokol, već izdati JWT traje do isteka; PLATFORM_ADMIN refresh iz deaktivirane firme ostaje dozvoljen postojećim pravilom. Velika firma može zadržati lock/isteći transakcijski timeout i cijela izmjena se rollbackuje

## F-CI-05-40

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Admin reset lozinke mogao je provjeriti ciljnu rolu/tenant prije čekanja, pa resetovati viši ili premješteni nalog
- **Modul/dokaz:** `backend/src/modules/users/users.service.ts`, `backend/test/auth.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Pod user lockom ponovo se provjeravaju tenant i ciljne role, te se hash i opoziv upisuju u istoj transakciji. DB E2E kontroliše promociju cilja tokom čekanja i rollback pri padu opoziva. Ograničeni refaktor uklanja TOCTOU bez nove zavisnosti/migracije. Role i prava samog aktera i dalje su snapshot iz guarda, stari/vanjski pisci ne moraju držati lock; last-SUPER_ADMIN konkurencija ostaje zaseban nalaz

## F-CI-05-41

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Konkurentni zahtjevi mogli su provjeriti isti broj SUPER_ADMIN-a i ostaviti firmu bez ijednog aktivnog; deaktivacija zadnjeg nije bila zaštićena
- **Modul/dokaz:** `backend/src/modules/users/users.service.ts`, `backend/src/modules/users/role-escalation.ts`, `backend/test/tenant.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Promjene statusa/rola prvo zaključavaju firmu pa korisnika, brojač aktivnih se provjerava unutar iste transakcije. Zabranjuje se democija i deaktivacija posljednjeg aktivnog, dok je uklanjanje role neaktivnom korisniku dopušteno. DB E2E kontroliše dva istovremena zahtjeva, samostalne zabrane i neaktivni nalog. Ograničeni refaktor opravdan održavanjem ranije dokumentovanog pravila; nema migracije/zavisnosti. Pravila ne popravljaju unaprijed postojeće firme bez aktivnog super admina; stari ili vanjski pisci i snapshot prava aktera ostaju ograničenje

## F-CI-05-42

- **Težina:** srednje. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Prototip je provjeravao samo postojanje izvještaja za `done`, ali ne i status u njima; planirani izvještaj mogao je nedostajati
- **Modul/dokaz:** `scripts/audit/check-audit-gate.mjs`, regresijski test. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Za svaki segment traži izvještaj, odgovarajući naslov i status registra u zaglavlju i zapisu izvršavanja; testovi pogrešnih/nedostajućih statusa, naslova i planiranog izvještaja. Provjera je tekstualna i ne dokazuje kvalitet samog pregleda

## F-CI-05-43

- **Težina:** nisko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Coverage gate prihvatao je nepostojeći kalendarski datum koji odgovara formatu ISO
- **Modul/dokaz:** `scripts/audit/check-coverage.mjs`, regresijski test. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** UTC round-trip odbija overflow dana i pogrešan mjesec; testira prestupnu godinu. Datumi se provjeravaju samo za pregledane statuse; nalaz ne potvrđuje autentičnost pregleda

## F-CI-05-44

- **Težina:** srednje. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Razmak prije dvotačke, citirani `uses` i inline koraci mogli su zaobići tekstualni skener pinovanja
- **Modul/dokaz:** `scripts/audit/check-audit-gate.mjs`, regresijski test. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Navedeni alternativni oblici se odbijaju uz testove; ostaje uska tekstualna provjera, ne opšti YAML parser: drugi YAML oblici, aliasi i semantika lokalnih akcija nisu dokazano pokriveni. Strogi gate nije uključen u CI

## F-CI-05-45

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Zakašnjeli upload ili retry poslije promjene projekta mogao je prikazati prethodni fajl u novom projektu, a stari uspjeh obrisati noviju referencu ili osvježiti pogrešan keš
- **Modul/dokaz:** `frontend/src/components/ops/project-tabs.tsx`, regresijski testovi. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Referenca i završetak oporavka vezani za generaciju sesije, korisnika, firmu i ID projekta; zahtjevi i invalidacija koriste izvorni projekat, uspjeh uklanja samo svoj ključ. Provjera konteksta nakon uploada i liste sprečava slanje narednog koraka nakon zatečene promjene korisnika/firme. Šest kontrolisanih regresija. Tada je state bio u memoriji komponente; F-CI-05-46 zadržava ga u kešu nakon unmounta. Reload, već poslani zahtjev i ostala ograničenja F-CI-05-15 ostaju; F-CI-05-48 kasnije ublažava ABA promjenu izbora firme u istom tabu

## F-CI-05-46

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Nepotvrđena veza i kontrola tekućeg uploada gubile su se unmountom komponente; povratak je mogao pokrenuti još jedan upload
- **Modul/dokaz:** `frontend/src/components/ops/project-tabs.tsx`, `frontend/src/i18n/ops-{bs,en}.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Postojeći React Query keš u memoriji čuva stanje po sesiji/korisniku/firmi/projektu i preživljava remount; dijeljena blokada ne dozvoljava paralelan retry iz dva prikaza istog keša. Kontrolisane regresije: greška, upload i povezivanje pri unmountu, brisanje keša i dva prikaza. Potreban ograničen refaktor jer stanje komponente ne postoji po njenom uklanjanju; bez nove zavisnosti. Keš se ne čuva preko reloada niti dijeli između browser tabova; nakon gubitka upload odgovora ne zna se putanja. GC je isključen za ovaj keš do čišćenja sesije, uz trošak memorije

## F-CI-05-47

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Direktni neuspješni refresh brisao je sesiju, ali ne i korisnički keš ako pozivalac nije naknadno pozvao `forceLogin`
- **Modul/dokaz:** `frontend/src/lib/api-client.ts`, `frontend/src/lib/api-client.spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Odbijeni refresh koristi postojeći `clearSession` za store, keš i token. Mrežna greška čuva keš/sesiju; zakašnjeli odgovor starog refresha ne briše novu sesiju ni njen keš. Tri regresijska scenarija, bez nove zavisnosti

## F-CI-05-48

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Platform administrator može tokom zahtjeva promijeniti firmu A → B → A; provjera samo konačnog ID-a prihvatala je stari odgovor ili ponavljala staru mutaciju
- **Modul/dokaz:** `frontend/src/stores/company-store.ts`, `frontend/src/lib/api-client.ts`, `frontend/src/components/ops/project-tabs.tsx`, pripadajući testovi. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Monotona revizija izbora raste samo na stvarnu promjenu; API/Blob i dokumentni višekorak bilježe reviziju i odbacuju stare odgovore/retry i nakon povratka. Keš nepotvrđenog dokumenta ostaje vezan za projekat/firmu, pa je novi namjerni retry moguć. Deset regresijskih slučajeva uključuju promjenu tokom refresh-a, identičan izbor, običnog korisnika i tekuće povezivanje. Ograničeni refaktor bez zavisnosti: ID sam ne razlikuje ABA. Ne poništava već obrađen serverski zahtjev; ne prati vanjske/stare klijente, direktno mijenjanje storea ni ABA promjene korisničkih prava/firmi van ovog prekidača

## F-CI-05-49

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Ključ idempotentnosti nestajao je fizičkim brisanjem veze; zakašnjeli retry mogao je ponovo napraviti obrisani dokument, a frontend je tuđi zapis iste putanje mogao smatrati dokazom uspjeha
- **Modul/dokaz:** `backend/src/modules/ops/documents.service.ts`, Prisma model/migracija, `backend/test/projects.e2e-spec.ts`, `frontend/src/components/ops/project-tabs.tsx`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Soft-delete čuva ključ i vraća `409 PROJECT_DOCUMENT_REMOVED` za istu operaciju, lista skriva tombstone, drugi payload ostaje `CONFLICT`, novi ključ i legacy kreiranje ostaju mogući. Uslovni update daje jednog pobjednika kod konkurentnih brisanja. Frontend provjerava isti ključ na serveru umjesto zaključivanja po putanji/nazivu i uklanja samo referencu koju server izričito označi obrisanom; ostali konflikti ostaju za oporavak. Aditivna migracija i ograničeni refaktor potrebni su jer se ključ fizički obrisanog reda ne može dokazati; nema novih zavisnosti. PostgreSQL E2E: konkurentni retry/brisanje, dupli delete, audit, sakrivena lista, novi ključ, legacy i projektna izolacija; frontend regresije. Ograničenja: ranije obrisani redovi, stari/miješani serveri, direktni DB/cascade delete, gubitak upload odgovora, reload i audit best-effort. Tombstone se čuva neograničeno; staru verziju nije sigurno koristiti/rollbackovati bez plana

## F-CI-05-50

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Privremeni `429` pri refreshu tretiran je kao opozvana sesija, brisao token, korisnika i korisnički keš, uključujući nepotvrđenu vezu dokumenta; bootstrap je mrežne greške skrivao
- **Modul/dokaz:** `frontend/src/lib/api-client.ts`, `frontend/src/hooks/use-auth-bootstrap.ts`, `frontend/src/components/auth/{boot-gate,session-recovery}.tsx`, Playwright i unit regresije. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** HTTP 429 (i ne-JSON) vraća `RATE_LIMITED` bez brisanja i bez automatskog retryja; važeći 401/reuse i dalje čisti sesiju. Bootstrap za 429/mrežu nudi pristupačan ekran sa retryjem ili nastavkom bez obnove; retry profila nakon uspješnog refresha ne rotira token opet. Provjere generacije i unmount sprečavaju stari bootstrap da prepiše ili odjavi novi nalog. Ograničeno izdvajanje BootGate/ekrana je potrebno za vidljiv i testabilan oporavak; bez novih zavisnosti ili migracija. Testovi JSON/ne-JSON, API/Blob, cache, single-flight, zakašnjeli odgovor, retry profila, UI i Playwright. Pretpostavlja se 429 prije rotacije (naš Nest throttler je guard); 5xx i dalje odjavljuje, nepoznat ishod mrežnog prekida i posrednik koji prepiše uspješan odgovor ostaju rizik F-FE-06-06. Nastavak ne briše token, ali nova prijava ga može zamijeniti

## F-CI-05-51

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** nije još utvrđen.
- **Scenarij:** Samo invalidacija keša pri promjeni firme ostavlja prethodne query podatke vidljivima tokom učitavanja ili nakon neuspjeha novog zahtjeva
- **Modul/dokaz:** `frontend/src/stores/company-store.ts`, `frontend/src/stores/company-cache.spec.tsx`, projekti i browser regresije. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Stvarna promjena resetuje aktivne i neaktivne query podatke prije novog učitavanja; isti izbor ne resetuje. Zajednički ključ izuzima isključivo keš oporavka dokumenta, koji je zasebno scopeovan i preživljava A→B→A. Testovi stvarnog QueryClienta, zakašnjelog rezultata, greške, povratka, liste projekata, switchera i retryja dokumenta. Browser test sa mockovanim firmama i greškom prošao u CI 41906819817 (6/6). Bez nove zavisnosti; reset svih aktivnih upita košta dodatne zahtjeve i ne može poništiti serversku mutaciju. Važi za zajednički QueryClient i standardni setter; drugi klijenti, direktan store i budući `initialData` nisu obuhvaćeni. Lokalni React state je zasebni otvoreni F-CI-05-52

## F-CI-05-52

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Otvoreni oblici i drugi lokalni React state nisu scopeovani na firmu, pa nakon promjene mogu zadržati podatke ili nacrt prethodne firme
- **Modul/dokaz:** `frontend/src/pages/projects-page.tsx`, `frontend/src/pages/users-page.tsx` i drugi oblici. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: standardni setter odbija stvarnu promjenu dok je otvoren Sheet, Dialog ili AlertDialog, uključujući prikazanu jednokratnu lozinku; izbor iste firme je no-op. Lockovi su nezavisni i oslobađaju se pri zatvaranju/unmountu; navigacijski sheet je izuzet da bi izbor firme ostao upotrebljiv. Lokalizovana poruka; nema resetovanja keša, storagea ni revizije kad je izbor odbijen. Ugradnja u UI primitive namjerno pokriva postojeće i buduće modalne obrasce bez pojedinačnog opt-in propusta, ali i nemutirajuće dijaloge; bez novih zavisnosti. Dodatno su zaštićeni nacrti novih količina i dnevnika projekta te materijala i deponija: izričito odbacivanje ili uspješan upis vraća početne vrijednosti, a tokom upisa polja i odbacivanje su blokirani. Ovo nije puna izolacija: drugi inline obrasci i blur-upisi postojećih redova, lokalni state izvan obuhvata, navigacija/reload i operacije nakon zatvaranja/unmounta, rezultat u toku prije prikaza lozinke, drugi tab/klijenti, direktan Zustand setState i već obrađene mutacije nisu zaštićeni. Obješeni zahtjev blokira izbor dok je komponenta montirana; odlazak/reload mogu odbaciti nacrt i ne otkazuju obradu na serveru. Nema automatskog remounta koji bi odbacio nacrte. Privremeno sačuvati ili zatvoriti inline obrasce, sačekati završetak radnji i provjeriti firmu prije promjene.

## F-CI-05-53

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Potvrda reseta lozinke zatvarala se prije odgovora, čime se pri promjeni firme mogla izgubiti jednokratna lozinka ili poslati ponovni reset
- **Modul/dokaz:** `frontend/src/pages/users-page.tsx`, `users-page.spec.tsx`, `frontend/e2e/login.spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: potvrda ostaje otvorena tokom upisa, onemogućava zatvaranje, dupli klik i promjenu firme; uspješan odgovor otvara dijalog lozinke. Nakon greške nema automatskog ni neposrednog retryja; eksplicitno se upozorava na mogući već izvršen reset. Testovi dvostrukog klika, Escape, uspjeha i nepoznatog ishoda; browser test prošao u CI 41918214201 (6/6). Stranica/tab/reload/sesija, nestao odgovor i drugi klijenti ostaju van zaštite. Zahtjev koji ne završi ostavlja dijalog blokiran; reload ne poništava obradu na serveru. Kreiranja korisnika/firme dodatno su djelimično zaštićena (F-CI-05-54). Bez novih zavisnosti.

## F-CI-05-54

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Kreiranje korisnika i firme moglo se nastaviti nakon zatvaranja obrasca ili se duplicirati dok čeka odgovor s jednokratnom lozinkom
- **Modul/dokaz:** `frontend/src/components/users/user-sheet.tsx`, `frontend/src/components/companies/company-sheet.tsx`, pripadajući page i browser testovi. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: ref blokira paralelni submit, Sheet ne zatvara tokom upisa, polja su zaključana; uspjeh prikazuje jednokratnu lozinku. Kod greške kreiranja nacrt ostaje i korisnik mora izričito omogućiti novi pokušaj nakon upozorenja da zapis možda već postoji. Četiri kontrolisane regresije + browser test prošao u CI 41921033070 (6/6). Navigacija/unmount/reload, promjena sesije, drugi tab/klijenti i izgubljeni odgovor nisu pokriveni; viseći zahtjev blokira dijalog dok je montiran. Bez novih zavisnosti.

## F-CI-05-55

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Odlazak sa stranice tokom kreiranja/reseta ili dok je jednokratna lozinka vidljiva može izgubiti odgovor
- **Modul/dokaz:** `frontend/src/hooks/use-sensitive-navigation.ts`, `frontend/src/lib/sensitive-navigation.ts`, AppShell i osjetljivi obrasci. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: jedan React Router data blocker za link/back/programatsku navigaciju sa prevedenom porukom; browseru se traži standardno `beforeunload` upozorenje; nezavisni lockovi ne blokiraju sigurnosnu odjavu nakon čišćenja sesije. Browser CI 41982514052 pao na history testu; detaljan log nije dostupan (EOF), vjerovatni uzrok je `page.goto` umjesto router linka; test je ispravljen i daje sigurnu anotaciju faze; korektivni CI 41983025115 prošao je 6/6, precizni uzrok prethodnog pada ostaje nepotvrđen. Data-router unit regresije prolaze. Historija nastala izvan data routera nije pouzdano pokrivena router blockerom; cross-document odlazak zavisi od native unload upozorenja. Native prompt zavisi od browsera i korisnik ga može prihvatiti; pad procesa, nepredviđeni unmount, promjena sesije, izgubljen odgovor, vanjski klijenti, drugi obrasci i tabs ostaju otvoreni. Nema trajnog pohranjivanja lozinke ni server-side idempotentnosti.

## F-CI-05-56

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** ERP partner nacrt i upis mogu nestati pri promjeni kartice/firme ili biti duplirani nakon nepoznatog ishoda
- **Modul/dokaz:** `frontend/src/components/erp/erp-partners-tab.tsx`, `frontend/src/pages/erp-page.tsx`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: kontrolisana polja, lock firme/data-routera i blokada ERP kartice za nacrt/pending, svjesno odbacivanje, sinhroni submit latch; greška čuva nacrt i traži potvrdu za retry. Testirani izbor tipa, pending, neuspjeh i uspjeh. Native unload zavisi od browsera; retry nije server-idempotentan i može duplirati partnera, promjena sesije/prava, nepredviđeni unmount i drugi klijenti nisu pokriveni; zahtjev bez odgovora može blokirati dok je komponenta montirana. Ostali ERP obrasci nisu obuhvaćeni. CI 41984425881 prošao je 6/6.

## F-CI-05-57

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** 3ee7d1c, 3a52464.
- **Scenarij:** Nacrt ili nepoznat ishod ručnog ERP troška mogu uzrokovati gubitak unosa ili dupliranje
- **Modul/dokaz:** `frontend/src/components/erp/erp-costs-tab.tsx`, `frontend/src/pages/erp-page.tsx`, `backend/src/modules/erp/costs.service.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: kontrolisana polja i zaštita firme, kartice, navigacije; odbacivanje, sinhroni latch, zadržavanje nacrta i upozorenje uz svjesni retry. Backend sada ima opcionalni UUIDv4 po firmi, SHA-256 normalizovanog zahtjeva i trajni receipt/tombstone; isti zahtjev vraća postojeći trošak, promijenjeni ili obrisani 409, receipt/cost/preračun su atomski. Lokalni PostgreSQL E2E 16/124 i CI 42046643464 6/6. Frontend sada čuva originalni payload i UUID u memorijskom kešu po sesiji/korisniku/firmi, sa zajedničkom bravom, zaključanim poljima i svjesnim retryjem; oporavak preživljava remount, promijenjena revizija firme blokira retry. Unit testovi pokrivaju UUID, remount, konkurentne prikaze, parkirani nacrt, scope i zakašnjele odgovore; browser lost-response test prošao u CI 42080762248 (6/6). Reload/odjava/brisanje keša/odbacivanje gube ključ, neposlani nacrti i nezavisni tabovi i stari/miješani serveri ostaju rizik; audit je best-effort nakon commita; lista nakon greške može biti zastarjela ili nepotpuna. Native unload, sesija/prava, nepredviđeni unmount neslanog nacrta i drugi klijenti nisu garancija. Obračun i lager ostaju izvan opsega ovog nalaza. CI 41985763584 prošao 6/6.

## F-CI-05-58

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** ERP obračun troška može izgubiti period ili prikaz ishoda pri promjeni kartice/firme i ponovljenom upisu
- **Modul/dokaz:** `frontend/src/components/erp/erp-costs-tab.tsx`, `backend/src/modules/erp/from-payroll.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: kontrolisani period, lock firme/kartice/data-routera, odbacivanje i sinhroni pending latch; greška čuva period i traži svjesni retry; drugi ručni obrazac nezavisno zadržava lock. Jedinstvenost firma/izvor/period daje 409 dok zapis postoji, ne replay rezultata; brisanje i drugi opseg dozvoljavaju novi upis, audit može pasti poslije kreiranja. Native unload, sesija/prava/unmount i drugi klijenti nisu garancija; lista može biti zastarjela/nepotpuna. CI 41986803974 prošao 6/6.

## F-CI-05-59

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** ERP nacrt skladišta i nepoznat ishod kreiranja mogu nestati ili izazvati duplikat
- **Modul/dokaz:** `frontend/src/components/erp/erp-stock-tab.tsx`, `frontend/src/pages/erp-page.tsx`, `backend/src/modules/erp/warehouses.service.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: kontrolisana polja, lock firme/kartice/data-routera, odbacivanje, sinhroni latch i upozorenje sa svjesnim retryjem. Server nema idempotentni ključ, audit je best-effort nakon kreiranja; izgubljen odgovor i retry mogu duplirati zapis; lista može biti zastarjela/nepotpuna i ograničena na 100. Native unload, sesija/prava, nepredviđeni unmount i drugi klijenti nisu garancija; knjiženje kretanja nije obuhvaćeno ovim nalazom. CI 41988654993 prošao 6/6.

## F-CI-05-60

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Nacrt kretanja zaliha ili nepoznat ishod mogu nestati, promijeniti odabir ili dovesti do duplog knjiženja
- **Modul/dokaz:** `frontend/src/components/erp/erp-stock-tab.tsx`, `backend/src/modules/erp/stock.service.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: ID izbori ostaju pri reorderu; nedostajući ID zadržava nacrt i blokira slanje, čak i kad obje liste nestanu. Lock firme/kartice/data-routera, sinhroni latch, svjesno odbacivanje/retry, pending i zamrznuta polja nepoznatog ishoda; uspjeh čisti količinu. Frontend sada čuva UUID i originalni payload za svjesni retry, uz zaključana polja i provjeru sesije/korisnika/firme/revizije; oporavak preživljava unmount u memorijskom kešu, ali ne reload ili brisanje sesije; audit je best-effort nakon transakcije; agregatni zbir ne dokazuje ishod zahtjeva. Native unload, sesija/prava, unmount i drugi klijenti nisu garancija. CI 41991239254 5/6: Web E2E ERP test došao na prijavu, puni log EOF; moguća prekinuta bootstrap rotacija u testnom beforeEach, ne potvrđen uzrok. Korektivni CI 41991834006 prošao 6/6; uzrok prvog pada nije potvrđen.

## F-CI-05-61

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Server ranije nije imao siguran retry ručnog stock pokreta
- **Modul/dokaz:** `backend/src/modules/erp/stock.service.ts`, `warehouses.dto.ts`, `backend/prisma/schema/erp.prisma`, migracija i E2E. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: opcionalni UUIDv4 po firmi, SHA-256 kanonskog zahtjeva, replay prije provjere stanja, konflikt za drugi sadržaj i SERIALIZABLE/unique zaštita; bez ključa ostaje stari tok. Normalni audit DB neuspjeh se hvata i loguje, audit je post-commit best-effort. Frontend koristi ključ i isti payload tokom zadržanog pokušaja; reload/gubitak ključa, fizičko brisanje, mixed-version i vanjski pisci ostaju rizik. PostgreSQL E2E/migracija prošli u CI 41995812499 (6/6), frontend unit/build i Web E2E u 41996958141 (6/6). Dodatni browser test prekida odgovor nakon stvarnog commita, ponavlja UI zahtjev i provjerava jednak payload/ID i saldo novog skladišta; taj dodatni test prošao je u CI 42000646828 (6/6).

## F-CI-05-62

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** nije još utvrđen.
- **Scenarij:** Nepotvrđen stock pokret ili upis u toku gubi ključ pri uklanjanju i ponovnom montiranju obrasca; dva prikaza mogu pokušati isti upis
- **Modul/dokaz:** `frontend/src/components/erp/erp-stock-tab.tsx`, `frontend/src/stores/company-store.ts`, `frontend/src/pages/erp-page.spec.tsx`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: postojeći Query keš drži payload, UUID, stanje i sinhroni lock po generaciji sesije/korisniku/firmi. Preživljava unmount i reset upita pri promjeni firme, a logout/brisanje keša ga uklanja; kasni rezultat ne vraća obrisani keš. Revizija firme ostaje u operaciji, pa A→B→A može prikazati oporavak, ali ne dozvoljava retry starog konteksta. Više prikaza dijeli lock; zasebni lokalni nacrt privremeno se parkira i vraća. Pokriveni remount tokom uspjeha/greške, nepoznat ishod, utrka prikaza, promjena sesije/firme i kasni odgovor. Potreban ciljani refaktor zbog dijeljenog životnog vijeka; nema nove zavisnosti. Keš je memorijski i ne dijeli se među tabovima; reload/odjava, odbacivanje, drugi klijenti, stari/miješani serveri i obješeni zahtjevi ostaju rizik. Ne poslani nacrt i parkirani nacrt ne preživljavaju unmount; neočekivana promjena scopea može odbaciti lokalni nacrt. Infinity GC troši memoriju do čišćenja sesije; native navigation upozorenje nije garancija.

## F-CI-05-63

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** 1561d40.
- **Scenarij:** Zajednički decimalni parser odbijao je NaN, ali prihvatao ±Infinity i ekstremni eksponent koji Decimal pretvara u Infinity; podaci su mogli doći do baze i rezultirati greškom umjesto 400
- **Modul/dokaz:** `backend/src/common/utils/decimal-input.ts`, `decimal-input.spec.ts`, `geo.spec.ts`, `backend/test/erp.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** `isFinite()` odbija i NaN i beskonačne decimalne vrijednosti prije provjera predznaka i upisa; ostaje postojeći `400 VALIDATION_FAILED`. Testovi stvarnog Prisma Decimal-a za sve četiri funkcije i predznake, postojeća geo mock-klasa usklađena; PostgreSQL E2E za stock, troškove, projekte, količine i gorivo prošao u CI 42005814031 (6/6). Bez zavisnosti/migracije. Ne validira sva sirova Decimal polja koja zaobilaze pomoćnik, skalu/preciznost kolone, ekstremno podlijevanje ili već postojeće podatke (F-CI-05-64).

## F-CI-05-64

**Dopuna BE-01 (u radu):** zajednički parser odbija podlijevanje nenultih ulaza; unit regresija i PG E2E, a ostala polja/skale i stari podaci ostaju otvoreni (BL-001). Dopuna je commit `8cac43d`; puni CI [42108548062](https://github.com/mudzy992/gradix/actions/runs/42108548062) je prošao 6/6.

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** da68931, 5e9a4cd.
- **Scenarij:** Konačan Decimal može preći opseg DB kolone, tiho se zaokružiti ili se ekstremno mali eksponent podliti u nulu; neka polja uopće ne koriste zajednički parser
- **Modul/dokaz:** `backend/src/common/utils/decimal-input.ts`, `backend/src/modules/erp/stock.service.ts`, decimalna polja u Prisma šemi i servisi. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično za ručna stock kretanja: novi upisi zahtijevaju nenultu količinu tačno predstavljivu u `numeric(12,3)`; replay ranije zapisanog ključa je prije novog ograničenja i zadržava originalni otisak. Frontend provjerava decimalni/naučni zapis prije UUID-a ili mreže, čuva nacrt i lokalizovano opisuje grešku; stari memorijski retry preskače novu validaciju. Unit testovi granica, predznaka, eksponenata i starog retryja prolaze; CI 42007301128 pao 5/6: stariji lost-response E2E slao je sada nevaljanu količinu; korekcija koristi `0.001`. Sa privremenim PostgreSQL 16 lokalno prolazi cijeli E2E (16 suite / 110 testova); SQL migracije i readiness evidencija ručno primijenjeni, nije `prisma migrate deploy`. Korektivni CI 42008207275 prošao 6/6. Nema novih repo zavisnosti/migracija. Direktni `POST /cost-entries` sada traži egzaktan nenegativan numeric(12,2), uključujući zaštitu od Decimal podlijevanja, a UI lokalizovano validira decimalni/naučni unos; lokalni PostgreSQL E2E 16/111 i CI 42009652188 (6/6). Ostala polja i direktni upisi ostaju otvoreni; ekstremni underflow zajedničkog Decimal parsera ostaje rizik za druga polja. Stari/miješani serveri mogu pisati po starim pravilima; replay nije zagarantovan ako stari server istovremeno tek obrađuje isti ključ prije nego što novi server provjeri njegov red.

## F-CI-05-65

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** b65e2c2, 8566190.
- **Scenarij:** Direktno kreiranje povezanog troška i preračun `Project.currentSpend` nisu atomski; overflow zbira ili greška preračuna može ostaviti trošak upisanim uz grešku API-ja i zastarjelu potrošnju
- **Modul/dokaz:** `backend/src/modules/erp/costs.service.ts`, `backend/src/modules/ops/spend.ts`, `backend/prisma/schema/ops.prisma`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: direktni i payroll cost create te povezani preračun su atomski; create/delete troškova uzimaju tenant-scope project `FOR NO KEY UPDATE` prije promjene, a delete provjerava red nakon čekanja. `recalcSpend` za sve pozive odbija ukupni overflow sa 409 prije updatea. PostgreSQL E2E rollback, kontrolisana lock utrka create/delete, double delete, payroll/ručni pri granici i tenant izolacija; lokalno 16 suite / 116 E2E i CI 42012462050 (6/6). Gorivo, završetak servisa i ispravke goriva sada sarađuju istim projekt lockom; fuel red se zaključava prije čitanja, projektne brave uzimaju se sortirano. PostgreSQL miješane utrke, suprotni transferi, overflow rollback i scope testovi lokalno prošli (16/120), CI 42014963993 prošao 6/6; stari/vanjski pisci, lock timeout, payroll snapshot izvan transakcije i postojeći podaci nisu zaštićeni. Audit je poslije commita; bez ključa izgubljen odgovor i retry mogu duplirati trošak (F-57).

## F-CI-05-66

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** 8566190.
- **Scenarij:** Ispravka `FUEL.projectId` prihvatala je projekat druge firme i mogla promijeniti njegov zbir
- **Modul/dokaz:** `backend/src/modules/ops/amendment-fleet.ts`, `backend/src/modules/ops/spend.ts`, `backend/test/erp.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Tenant-scope lock starog i novog projekta prije promjene; tuđi ili nedostajući projekt 404 bez upisa/ispravke/audita. Testirani i čišćenje veze, rollback prevelikog zbira i konkurentni transferi; lokalni PostgreSQL E2E prolazi, CI 42014963993 prošao 6/6. Legacy pogrešne veze nisu popravljene i njihova ispravka se odbija; status projekta i prava tokom čekanja, stari serveri i vanjski pisci ostaju izvan zaštite.

## F-CI-05-67

- **Težina:** visoko. **Status:** popravka evidentirana — provjeriti preostali obim. **Commit:** 3cd2e5d.
- **Scenarij:** Ručno kretanje zaliha prihvatalo je tuđi `projectId` ili prenosilo loš podrazumijevani projekt skladišta; nepostojeći ID izazivao je DB grešku
- **Modul/dokaz:** `backend/src/modules/erp/stock.service.ts`, `warehouses.dto.ts`, `backend/test/erp.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Novi upisi provjeravaju efektivni projekt u firmi pod `FOR SHARE` unutar SERIALIZABLE transakcije; tuđi/nedostajući 404, prazan 400. Nakon stvarno opažene konkurentne promjene firme, raw `P2010`/SQLSTATE 40001 se ograničeno ponavlja kao P2034, do 3 pokušaja; drugi raw kodovi se ne ponavljaju. Unit testovi i svježi PostgreSQL E2E 16/126 uključuju čekanje na lock, tenant promjenu, oba izvora projekta, rollback i replay; CI 42085642874 prošao 6/6. Već pohranjen keyed replay namjerno prethodi provjeri i ne popravlja historijski loše veze. Vanjski/miješani pisci i već postojeći loši redovi nisu pokriveni.

## F-CI-05-68

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** 776c403.
- **Scenarij:** `apply-stock` očitava gorivo izvan transakcije i može primijeniti zastarjele litre/projekt ili prenijeti legacy tuđi projekt; retry nakon serialization konflikta može prije replaya odbiti sada praznu zalihu
- **Modul/dokaz:** `backend/src/modules/erp/stock.service.ts`, `backend/test/erp.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: replay unutar svakog SERIALIZABLE pokušaja prije stanja, tenant fuel `FOR SHARE` i svježi podaci pa tenant project `FOR SHARE` po redoslijedu fuel → project; 404 bez upisa za tuđi/nedostajući projekt. PG E2E 16/131: tačna zaliha i paralelni retry, opaženo čekanje tokom promjene goriva i firme projekta, rollback, legacy strani projekt, replay i simulirani post-commit gubitak. Unit 40/298, lint/build i guard 37/37; CI 42095393195 prošao 6/6. Raniji replay i dalje vraća postojeći pokret bez upoređivanja skladišta/materijala, čak i za drugačije tijelo. Skladište/materijal se čitaju izvan transakcije, a naknadne izmjene obrađene su u F-70; stari podaci, miješane verzije i vanjski pisci nisu popravljeni; audit je best-effort poslije commita.

## F-CI-05-69

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** 71c299d.
- **Scenarij:** Kreiranje/ispravka goriva dozvoljavaju litre i cijenu koje baza zaokružuje; ukupni trošak se računa iz nepospremljene preciznosti ili prelazi DB granicu
- **Modul/dokaz:** `backend/src/common/utils/decimal-input.ts`, `backend/src/modules/ops/fuel.service.ts`, `amendment-fleet.ts`, `serialize-fleet.ts`, `backend/test/erp.e2e-spec.ts`, `backend/test/sync.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: nove litre moraju biti pozitivne i tačno stati u numeric(12,3), cijena nenegativna i tačno u numeric(12,2), zaokruženi ukupni trošak u numeric(12,2); invalidni ulaz 400 bez upisa. Za sync prethodno upisani identitet se vraća prije validacije i bez poređenja payloada. Unit 41/314 i svježi PG E2E 16/133 pokrivaju granice, podlijevanje, polovično zaokruživanje, rollback, audit, zbir i sync retry; lokalne SQL migracije i readiness metadata ručno učitane, CI 42096898797 prošao 6/6. Stari podaci, drugi decimalni tokovi i stariji/miješani serveri ostaju otvoreni; F-70 pokriva nove ispravke povezanog lagera.

## F-CI-05-70

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** 54813fa.
- **Scenarij:** Ispravka litara/projekta goriva nakon knjiženja ostavlja vezani stock pokret zastarjelim
- **Modul/dokaz:** `backend/src/modules/ops/amendment-fleet.ts`, `amendments.service.ts`, `backend/src/common/utils/serialization-retry.ts`, `backend/test/erp.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: fuel ispravke su SERIALIZABLE sa 3 pokušaja za P2034/SQLSTATE 40001; fuel → sortirani projekti, zatim usklađeni tenant pokret, delta/stanje zaliha, fuel, projekti i zapis Amendment atomarno. Stari neusklađeni/strani pokret se odbija 409 umjesto automatskog prepisivanja. Replay apply-stock vraća izmijenjeni red, ne snapshot. PG E2E 16/138 uključuje kontrolisane utrke sa stock izlazom i apply-stock, rollback, projektni overflow, negativnu zalihu, replay i legacy; unit 42/317, lint/build, coverage ratchet i 37 guard testova prošli. CI 42099914289 prošao 6/6. Nema idempotency ključa za ispravke, pa retry može dodati dupli Amendment i obavijest; vanjski/miješani pisci, promjene postavki/prava tokom čekanja, historijski loši podaci, vezani CostEntry i post-commit efekti ostaju otvoreni.

## F-CI-05-71

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** baca458.
- **Scenarij:** FUEL cost može referencirati tuđu/nepostojeću stavku ili drugi projekt; premještanje povezanog goriva ostavlja cost u starom projektu i može duplo brojati trošak
- **Modul/dokaz:** `backend/src/modules/erp/costs.service.ts`, `backend/src/modules/ops/amendment-fleet.ts`, `backend/test/erp.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: novo povezivanje koristi SERIALIZABLE + do tri retryja, tenant fuel lock prije projekta, 404 za strani/nedostajući fuel i 409 za različit projekt, uključujući null. Ispravka goriva ne može promijeniti projekt dok postoji vezani fuel cost; postojeći cost se ne mijenja niti briše automatski. Cijena/litre mogu se mijenjati, ručni iznos troška ostaje override; postojeći keyed replay prije novih provjera. Lokalno PG 16/142 E2E testovi uz opažene lock utrke, rollback ključa, tenant, null, replay, override i obračun; unit 43/321, lint/build, ratchet i guard 37/37. CI 42102237149 prošao 6/6. Uključivanje cost servisa u coverage ispoljilo je ranije krhki payroll mock, zamijenjen je stvarnim Decimalom; uzrok redoslijeda nije dokazan. SERVICE/PAYROLL source, raniji podaci, miješani/vanjski pisci, korisnički unesen iznos, neizvjesnost post-commit efekata i audit ostaju otvoreni.

## F-CI-05-72

- **Težina:** visoko. **Status:** djelimično / daljnja trijaža. **Commit:** 8ca1450.
- **Scenarij:** SERVICE trošak mogao je referencirati strani/nepostojeći servis ili pogrešan projekt i time kvariti obračun
- **Modul/dokaz:** `backend/src/modules/erp/costs.service.ts`, `backend/test/erp.e2e-spec.ts`. Testovi i rezultati: [CI-05 §7](segments/CI-05.md#7-testovi); navedeni testovi unutar odluke ispod.
- **Odluka i ograničenja iz izvora:** Djelimično: unutar postojeće READ COMMITTED transakcije projekt lock pa tenant `ServiceRecord FOR SHARE`, 404 za strani/nedostajući servis i 409 za projekt mismatch uključujući null. Čeka i potvrđuje ažurirani source red; redoslijed odgovara završavanju servisa. Status nije ograničen i ručni iznos je override, čak i prije završetka; postojeći keyed replay prethodi provjeri. Svježi PG E2E 16/146 obuhvata tenant/null, receipt rollback, replay, opaženo čekanje i istovremeni završetak bez duplog zbira; backend lint/build, unit 43/321, ratchet i guard 37/37 prošli. CI čeka. PAYROLL, historijski podaci, vanjski/miješani pisci, proizvoljni iznosi i post-commit efekti nisu riješeni.


# ADR 0014 — praćenje grešaka (ops, bez implementacije)

**Datum:** 2026-11-17 · **Status:** preporuka · **Opseg:** staging → pilot

## Problem

Kad web/API padne u produkciji, danas nemamo jedinstven kanal: Coolify logovi su
kratkotrajni, korisnik šalje screenshot, a agent ne vidi stack bez ručnog pristupa.
Treba odluka *prije* koda: šta skupljamo, šta nikad, koji alarmi su minimum.

## Alternative

1. **Samo Coolify/host logovi** — bez novog alata; jeftino, ali nema grupisanja,
   alertova ni povezivanja s releaseom.
2. **Self-hosted Greylog/Loki + Grafana** — pun kontrola nad podacima; operativni
   trošak (disk, upgrade, auth) veći od vrijednosti u pilotu.
3. **SaaS error tracker (npr. Sentry-klasa)** — brzo grupisanje, release health,
   alert na regresiju; DPA/ugovor i PII politika obavezni.
4. **Odgoditi do poslije pilota** — rizik da prvi pravi pad ostane nevidljiv.

## Preporuka

Za pilot: **(3) jedan SaaS error tracker**, feature-flag / env uključiv, samo
server + web client *error boundary*. Mobilni crash kasnije (zaseban ADR).
Dok DPA nije potpisan: ostati na (1) + ručni Coolify log uz incident.

## Šta se šalje / šta nikad

| Šalje se | Nikad |
|---|---|
| tip greške, stack (app kod), route/handler ime, release/commit, environment | lozinke, tokeni, cookie, `Authorization`, `.env` |
| anonymized user id (hash) ako treba frekvencija | email, ime, telefon, JMBG, sadržaj formi |
| HTTP status, latency bucket | SQL parametri s poslovnim podacima, dump tijela zahtjeva |
| breadcrumb navigacije (putanje bez query s ID-ovima tenanta ako nisu nužni) | prilozi, MinIO URL s potpisom, backup ključevi |

## Minimalni alarmi

1. Nova issue grupa u produkciji (prvi događaj).
2. Spike: >N događaja iste grupe / 5 min (N dogovoriti pri uključenju).
3. `/api/ready` ili health fail >2 min (može i Coolify health, ne mora tracker).

## Van obima

Implementacija SDK-a, izbor vendora, mobilni crash reporting, log aggregation,
PII scrubber detalji, R4b i poslovni alarmi (rokovi, sukobi).

## Posljedice

Nova zavisnost traži zaseban commit + Coolify tajne (DSN); bez DPA ne pali se na
pravim korisnicima. ADR ne uvodi kod.

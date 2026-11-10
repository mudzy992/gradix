# Maestro tokovi — Step 7 (samo fajlovi, ne izvršavaju se u CI-ju)

Ovi tokovi su **scenariji za ručno/lokalno pokretanje** na uređaju ili emulatoru.
Namjerno nisu dio CI-ja: zahtijevaju pravi build aplikacije, demo podatke
(`SEED_DEMO=true`, nalozi iz `docs/DEMO-STEP7.md`) i kontrolu mreže
(avionski režim), što CI runner nema.

Preduslovi:

1. Development build aplikacije (`ba.gradix.teren`) instaliran na uređaju.
2. Staging/demo backend dostupan i seedovan demo podacima.
3. Maestro CLI lokalno (`maestro --version`).

Pokretanje:

```bash
cd v2/apps/mobile
maestro test -e DEMO_LOZINKA=<demo-lozinka> maestro/offline-unos.yaml
maestro test -e DEMO_LOZINKA=<demo-lozinka> maestro/sef-grupa.yaml
maestro test maestro/povratak-mreze-jednom.yaml
```

Tokovi koriste vidljivi tekst i accessibility oznake ekrana Moj dan / Grupa,
pa ih promjena teksta na ekranu može pokvariti — tada prvo popravi tok, pa ekran.

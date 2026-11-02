# Changelog — spend-progress

## 2026-08-17 (Faza 10 kod)

- **Šta:** `currentSpend` = fuel/service osim kad postoji CostEntry tog sourceId; tad samo CostEntry. MANUAL/PAYROLL +=.
- **Zašto:** Faza 10 izvršena.

## 2026-08-15 (Faza 2 lock)

- **Šta:** Recalc i na cancel; nema dashboard u Fazi 2.
- **Zašto:** Review Faze 2.

## 2026-08-15 (peglanje)

- **Šta:** Količine ne ulaze u progress %.
- **Zašto:** Jedna formula ostaje; predmjer je evidencija.

## 2026-08-15 (freeze)

- **Šta:** Service spend samo ako projectId set.
- **Zašto:** Planning freeze; usklađeno sa service matricom.

## 2026-08-14

- **Šta:** Progress = sredina faza iz taskova; spend = gorivo pa servis pa ERP; sate ne gurati u budget bez stope.
- **Zašto:** Dashboard ne smije izmišljati brojeve.

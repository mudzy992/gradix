-- BE-14 (B12): istorijska satnica po sesiji.
-- Prije se iznos računao trenutnom satnicom korisnika, pa je svaka povišica mijenjala
-- i već odobrene/obračunate mjesece. Sesija sada pamti satnicu iz trenutka zatvaranja.
ALTER TABLE "TimerSession" ADD COLUMN "hourlyRateSnapshot" DECIMAL(10, 2);

-- BE-14: brisanje troška mijenja `currentSpend` projekta — auditu nedostaje akcija.
ALTER TYPE "AuditAction" ADD VALUE 'COST_ENTRY_REMOVED';

-- BE-14: ERP šifrarnici dosad nisu ostavljali audit trag.
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'WAREHOUSE_CREATED';

-- D1: unknown fuel amount is NULL. Existing cents, including zeros, are left unchanged.
-- Idempotent: this file originally omitted schema_migrations, so a later apply re-runs it.
BEGIN;

ALTER TABLE public.fuel_entries DROP CONSTRAINT IF EXISTS fuel_entries_amount_check;
ALTER TABLE public.fuel_entries ALTER COLUMN amount_cents DROP NOT NULL;
ALTER TABLE public.fuel_entries
  ADD CONSTRAINT fuel_entries_amount_check CHECK (amount_cents IS NULL OR amount_cents >= 0);

ALTER TABLE public.fuel_entries DROP CONSTRAINT IF EXISTS fuel_entries_unknown_price_check;
ALTER TABLE public.fuel_entries
  ADD CONSTRAINT fuel_entries_unknown_price_check
  CHECK (amount_cents IS NOT NULL OR unit_price_cents IS NULL);

INSERT INTO public.schema_migrations (name)
VALUES ('20261121190000_fuel_amount_unknown')
ON CONFLICT DO NOTHING;

COMMIT;

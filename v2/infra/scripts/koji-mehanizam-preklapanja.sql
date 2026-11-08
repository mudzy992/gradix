-- =============================================================================
-- Koji mehanizam brani preklapanje dodjela na OVOJ bazi?
--
-- Pokretanje (read-only, ne mijenja ništa):
--   psql "$DATABASE_URL" -f infra/scripts/koji-mehanizam-preklapanja.sql
--
-- Očekivani ishodi:
--   EXCLUDE USING gist            → btree_gist je instaliran; triger ukinut
--   triger + advisory lock        → fallback; EXCLUDE nije moguć (nema contrib-a ili prava)
--   NEISPRAVNO                    → nijedan ili oba; preklapanje NIJE zaštićeno kako treba
-- =============================================================================

SELECT
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'project_assignments'::regclass AND contype = 'x') AS exclude_constrainta,
  (SELECT string_agg(conname, ', ') FROM pg_constraint
    WHERE conrelid = 'project_assignments'::regclass AND contype = 'x') AS imena_constrainta,
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'project_assignments'::regclass AND NOT tgisinternal) AS trigera,
  (SELECT count(*) FROM pg_extension WHERE extname = 'btree_gist') AS btree_gist_instaliran,
  (SELECT count(*) FROM pg_available_extensions WHERE name = 'btree_gist') AS btree_gist_dostupan,
  (SELECT version()) AS postgres,
  CASE
    WHEN (SELECT count(*) FROM pg_constraint
           WHERE conrelid = 'project_assignments'::regclass AND contype = 'x') = 2
     AND (SELECT count(*) FROM pg_trigger
           WHERE tgrelid = 'project_assignments'::regclass AND NOT tgisinternal) = 0
      THEN 'EXCLUDE USING gist'
    WHEN (SELECT count(*) FROM pg_trigger
           WHERE tgrelid = 'project_assignments'::regclass AND NOT tgisinternal) = 1
     AND (SELECT count(*) FROM pg_constraint
           WHERE conrelid = 'project_assignments'::regclass AND contype = 'x') = 0
      THEN 'triger + advisory lock'
    ELSE 'NEISPRAVNO — provjeri odmah'
  END AS mehanizam;

-- Ime primijenjene migracije, da se vidi je li `…_preklapanje_gist` uopšte prošla:
SELECT name, applied_at FROM schema_migrations
 WHERE name IN ('20261109160000_r3_preklapanje_gist', '20261109170000_r3_iznimka_zahtjev')
 ORDER BY name;

-- Bootstrap rola za bazu. Nije migracija: role su cluster-level i u produkciji ih
-- kreira vlasnik infrastrukture, ne aplikacija.
--
-- Zašto postoji: PostgreSQL RLS NE važi za superusera ni (bez FORCE) za vlasnika tabele.
-- Spike u Fazi 1 je to dokazao padom svih testova izolacije kad se aplikacija konektovala
-- kao `postgres`. Aplikacija zato koristi odvojenu rolu:
--   - nije superuser
--   - nema BYPASSRLS
--   - nije vlasnik tabela (migracije radi druga rola)
--
-- U produkciji (Coolify) lozinku unosi vlasnik infrastrukture; ovdje je lokalno trust auth.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gradix_app') THEN
    CREATE ROLE gradix_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO gradix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gradix_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gradix_app;

-- Nove tabele iz budućih migracija dobijaju ista prava bez ručnog GRANT-a.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gradix_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gradix_app;

-- Bootstrap rola — pokreće se ADMIN konekcijom (vlasnik šeme / superuser) PRIJE migracija.
--
-- Zašto postoji: PostgreSQL RLS ne važi za superusera, a vlasnika tabele štiti tek
-- `FORCE ROW LEVEL SECURITY` (koji je uključen u migracijama). Dokazano u Fazi 1:
-- bez FORCE-a i bez odvojene role izolacija tiho pada.
--
-- Dva podržana modela postavljanja:
--   A) Dvije role (preporučeno): admin radi migracije, `gradix_app` radi aplikaciju.
--   B) Jedna rola (`gradix_app`) je i vlasnik šeme i aplikacijska rola. Radi ispravno
--      SAMO ako rola NIJE superuser — tada FORCE drži RLS i za vlasnika.
--
-- Ovaj fajl je idempotentan i siguran za ponovno pokretanje.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gradix_app') THEN
    CREATE ROLE gradix_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Ako je rola već postojala sa pogrešnim atributima (npr. superuser), ovo ih ispravlja.
-- NE mijenja lozinku: lozinku postavlja vlasnik infrastrukture.
-- Preskače se kad tekuća rola NIJE superuser (model B): tada `gradix_app` ne smije
-- sama sebi mijenjati atribute i to nije potrebno — ona je već NOSUPERUSER.
DO $$
DECLARE
  is_super BOOLEAN;
BEGIN
  SELECT rolsuper INTO is_super FROM pg_roles WHERE rolname = current_user;
  IF is_super THEN
    ALTER ROLE gradix_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Prava za model B (kad je gradix_app vlasnik baze). U modelu A ovo samo dodaje prava.
DO $$
BEGIN
  IF current_user <> 'gradix_app' THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO gradix_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gradix_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gradix_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gradix_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gradix_app';
  END IF;
END
$$;

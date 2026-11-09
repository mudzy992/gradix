-- Bootstrap rola — pokreće se ADMIN konekcijom (vlasnik šeme / superuser) PRIJE migracija.
--
-- Zašto postoji: PostgreSQL RLS ne važi za superusera, a vlasnika tabele štiti tek
-- `FORCE ROW LEVEL SECURITY` (koji je uključen u migracijama). Dokazano u Fazi 1:
-- bez FORCE-a i bez odvojene role izolacija tiho pada.
--
-- Podržani deploy koristi odvojene role: admin/vlasnik radi migracije, `gradix_app` radi aplikaciju.
-- Legacy testovi mogu koristiti vlasničku `gradix_app` rolu, ali runtime preflight takav deploy
-- odbija — aplikacijska rola ne smije biti vlasnik tabela.
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
-- Preskače se kad tekuća administratorska rola nije superuser: ona ne može mijenjati role
-- atribute. U tom slučaju DBA mora unaprijed postaviti `gradix_app` kao NOSUPERUSER/NOBYPASSRLS;
-- runtime preflight odbije start ako atributi nisu sigurni.
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

-- Prava za aplikacijsku rolu. U podržanom deployu tekuća rola je migrator, ne `gradix_app`.
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

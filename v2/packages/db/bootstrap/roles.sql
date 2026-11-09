-- Bootstrap rola — pokreće se ADMIN konekcijom PRIJE migracija.
--
-- `gradix_app` je samo runtime principal: NOSUPERUSER, NOBYPASSRLS, bez CREATE na `public`.
-- Objekti dobijaju isključivo prava iz odobrene matrice u `bootstrap/grants.sql`, nakon
-- migracija. Namjerno nema GRANT-a na sve tabele/sekvence ni širokih default privilegija.
--
-- Idempotentno; lozinku postavlja vlasnik infrastrukture, ne ovaj fajl.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gradix_app') THEN
    CREATE ROLE gradix_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Ako je rola već postojala sa pogrešnim atributima (npr. superuser), ispravi je.
-- Preskoči kad tekuća administratorska rola nije superuser; runtime preflight odbija
-- konfiguraciju koja nije NOSUPERUSER/NOBYPASSRLS.
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

-- Public schema nije prostor u koji aplikacijska ili PUBLIC rola smije kreirati objekte.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM gradix_app;

-- Default ACL važi samo za objekte budućeg DDL-a trenutne migracijske role. Nema prava
-- aplikaciji po defaultu; `grants.sql` daje samo matrice navedena prava nakon migracije.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM gradix_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM gradix_app;

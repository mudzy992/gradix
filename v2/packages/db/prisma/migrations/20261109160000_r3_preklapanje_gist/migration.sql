-- =============================================================================
-- R3 — preklapanje dodjela: pravi `EXCLUDE USING gist` umjesto trigera
--
-- Zašto: isključujući indeks je jedina stvar koju baza garantuje SAMA, bez obzira na to koliko
-- paralelnih transakcija uđe. Triger sa savjetodavnom bravom to takođe pokriva (dokazano testom
-- `assignments.race.integration.test.ts` — bez brave obje transakcije prođu), ali je garancija
-- posredna: ona visi o tome da svaki put neko ne zaboravi bravu.
--
-- Zašto fallback: `EXCLUDE` nad `daterange` uz `project_id` traži `btree_gist`. Na PostgreSQL 16 je
-- `btree_gist` **trusted**, pa ga vlasnik baze smije kreirati bez superuser-a — ali samo ako je
-- contrib paket instaliran. Slika `postgres:16` ga ima, gola instalacija bez contrib-a ne.
-- Zato migracija NIKAD ne pada zbog toga: ili podigne `EXCLUDE` i skine triger, ili ostavi triger
-- sa bravom. Precizno jedan mehanizam ostaje aktivan — nikad nijedan.
-- =============================================================================

DO $$
DECLARE
  ima_gist BOOLEAN := false;
  prinudno_triger BOOLEAN := current_setting('gradix.bez_btree_gist', true) = 'on';
BEGIN
  /*
   * PREKIDAČ ZA PROVJERU (`gradix.bez_btree_gist = on`).
   *
   * Zašto postoji: mehanizam se bira po tome POSTOJI li `btree_gist` na serveru, pa jedna baza ne
   * može pokazati oba puta. Bez ovoga bi fallback put bio provjeren samo na serveru bez contrib-a —
   * a to je tačno situacija u kojoj je greška (SQLSTATE 23P01 prepoznat kao „nepoznata") prošla
   * lokalno i pala u CI-ju. Sa prekidačem `scripts/check-preklapanje.mjs` vrti OBA puta na istom
   * serveru i tvrdi koji je aktivan.
   *
   * Prekidač NE mijenja ponašanje u produkciji: postavlja se po bazi (`ALTER DATABASE … SET`), i to
   * samo u skripti za provjeru.
   */
  IF prinudno_triger THEN
    RAISE NOTICE 'btree_gist preskočen prekidačem (gradix.bez_btree_gist): ide fallback put.';
    ima_gist := false;
  ELSE
  BEGIN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    ima_gist := true;
  EXCEPTION WHEN OTHERS THEN
    -- Nedostaje contrib paket ili pravo. Nije greška — triger ostaje na dužnosti.
    RAISE NOTICE 'btree_gist nije dostupan (%): ostaje triger sa savjetodavnom bravom.', SQLERRM;
    ima_gist := false;
  END;
  END IF;

  IF ima_gist THEN
    -- Dvije constraints, jedna po entitetu: `worker_id` i `machine_id` su naizmjenično NULL, pa
    -- jedna constraint nad oba stupca ne bi radila (NULL se ne poredi).
    ALTER TABLE project_assignments
      ADD CONSTRAINT project_assignments_worker_no_overlap
      EXCLUDE USING gist (
        project_id WITH =,
        worker_id  WITH =,
        -- `to_date` NULL znači „još traje", pa je gornja granica beskonačna. `'[]'` uključuje oba
        -- kraja: dodjela koja počinje na dan kad prethodna završava JESTE preklapanje.
        daterange(from_date, COALESCE(to_date, 'infinity'::date), '[]') WITH &&
      ) WHERE (worker_id IS NOT NULL);

    ALTER TABLE project_assignments
      ADD CONSTRAINT project_assignments_machine_no_overlap
      EXCLUDE USING gist (
        project_id WITH =,
        machine_id WITH =,
        daterange(from_date, COALESCE(to_date, 'infinity'::date), '[]') WITH &&
      ) WHERE (machine_id IS NOT NULL);

    -- Triger je sada suvišan; dva mehanizma za isto pravilo znače dva mjesta za grešku.
    DROP TRIGGER IF EXISTS project_assignments_no_overlap ON project_assignments;
    DROP FUNCTION IF EXISTS project_assignment_no_overlap();

    RAISE NOTICE 'Preklapanje dodjela: EXCLUDE USING gist (btree_gist), triger ukinut.';
  ELSE
    -- Fallback: triger MORA imati bravu. Ovo je ponovni upis iste funkcije iz R3 migracije —
    -- namjerno, da se ne može desiti da ostane verzija bez `pg_advisory_xact_lock`.
    CREATE OR REPLACE FUNCTION project_assignment_no_overlap()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      sukobi INTEGER;
    BEGIN
      IF NEW.worker_id IS NULL AND NEW.machine_id IS NULL THEN
        RETURN NEW;
      END IF;

      PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.company_id || ':' || NEW.project_id || ':' ||
                         COALESCE(NEW.worker_id, NEW.machine_id), 0)
      );

      SELECT count(*) INTO sukobi
        FROM project_assignments a
       WHERE a.company_id = NEW.company_id
         AND a.project_id = NEW.project_id
         AND a.id <> NEW.id
         AND (
           (NEW.worker_id IS NOT NULL AND a.worker_id = NEW.worker_id) OR
           (NEW.machine_id IS NOT NULL AND a.machine_id = NEW.machine_id)
         )
         AND a.from_date <= COALESCE(NEW.to_date, 'infinity'::date)
         AND NEW.from_date <= COALESCE(a.to_date, 'infinity'::date);

      IF sukobi > 0 THEN
        RAISE EXCEPTION 'ASSIGNMENT_OVERLAP'
          USING DETAIL = 'Isti entitet je već dodijeljen ovom projektu u periodu koji se preklapa.';
      END IF;

      RETURN NEW;
    END;
    $fn$;

    RAISE NOTICE 'Preklapanje dodjela: ostaje triger sa pg_advisory_xact_lock.';
  END IF;
END $$;

INSERT INTO schema_migrations (name) VALUES ('20261109160000_r3_preklapanje_gist')
  ON CONFLICT DO NOTHING;

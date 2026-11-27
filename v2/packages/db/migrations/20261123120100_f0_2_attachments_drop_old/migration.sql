-- F0.2 korak B: stare tabele priloga se uklanjaju.
--
-- Uslov: kod više ne čita `obligation_attachments`, `tender_attachments` ni
-- `machine_daily_check_attachments` (korak A je prenio redove u `attachments`).
-- Ova migracija je namjerno ODVOJENA od koraka A: između njih sistem radi normalno,
-- pa se korak B može odložiti ako se pokaže da nešto ipak čita staru tabelu.
--
-- Naprijed-samo: podaci su već u `attachments` (prenos u koraku A). Ova migracija
-- provjerava da nijedan red nije ostao neprenesen prije nego što ispusti tabele.

BEGIN;

DO $$
DECLARE
  missing BIGINT;
BEGIN
  SELECT count(*) INTO missing FROM public.obligation_attachments a
   WHERE NOT EXISTS (SELECT 1 FROM public.attachments t WHERE t.id = a.id);
  IF missing > 0 THEN
    RAISE EXCEPTION 'F0.2: % priloga obaveza nije preneseno u attachments', missing;
  END IF;

  SELECT count(*) INTO missing FROM public.tender_attachments a
   WHERE NOT EXISTS (SELECT 1 FROM public.attachments t WHERE t.id = a.id);
  IF missing > 0 THEN
    RAISE EXCEPTION 'F0.2: % priloga tendera nije preneseno u attachments', missing;
  END IF;

  SELECT count(*) INTO missing FROM public.machine_daily_check_attachments a
   WHERE NOT EXISTS (SELECT 1 FROM public.attachments t WHERE t.id = a.id);
  IF missing > 0 THEN
    RAISE EXCEPTION 'F0.2: % priloga pregleda nije preneseno u attachments', missing;
  END IF;
END
$$;

-- `obligation_versions.attachment_id` pokazuje na prilog: veza se preusmjerava na
-- zajedničku tabelu PRIJE nego što se stara ispusti (inače DROP pada).
ALTER TABLE public.obligation_versions
  DROP CONSTRAINT obligation_versions_attachment_fk;
ALTER TABLE public.obligation_versions
  ADD CONSTRAINT obligation_versions_attachment_fk
  FOREIGN KEY (attachment_id) REFERENCES public.attachments(id) ON DELETE SET NULL;

DROP TABLE public.obligation_attachments;
DROP TABLE public.tender_attachments;
DROP TABLE public.machine_daily_check_attachments;

INSERT INTO public.schema_migrations (name)
VALUES ('20261123120100_f0_2_attachments_drop_old')
ON CONFLICT DO NOTHING;

COMMIT;

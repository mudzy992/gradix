-- R3 closeout — novi članovi dobijaju najmanje privilegije, bez prepravljanja postojećih.
--
-- Samo mijenjamo DEFAULT. Namjerno nema UPDATE-a memberships: istorijski odobren opseg svakog
-- postojećeg člana ostaje nepromijenjen. Pozivnice i izmjene članstva moraju poslati scope izričito.
ALTER TABLE memberships
  ALTER COLUMN scope SET DEFAULT 'SELF';

-- Pozivnica se ne smije tiho izdati kao COMPANY ako pozivalac izostavi izbor.
ALTER TABLE invitations
  ALTER COLUMN scope DROP DEFAULT;

INSERT INTO schema_migrations (name)
  VALUES ('20261109180000_r3_scope_default_self')
  ON CONFLICT DO NOTHING;

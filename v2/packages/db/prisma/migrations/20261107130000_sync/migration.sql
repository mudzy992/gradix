-- Offline sync (R0 spike, Faza 1 korak 7).
-- Jedan zapis po (firma, korisnik, uređaj, lokalni ID) — idempotentnost push-a.
-- Izvor pravila: v1/docs/BACKEND.md §4.7 i v1 DECISIONS D-036 (limit batch-a, watermark bez preskakanja),
-- s namjernom razlikom: v2 ne nasljeđuje RLS izostanak — tabela je tenant-scope-ovana.

CREATE TABLE sync_items (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    TEXT NOT NULL,
  -- Klijentski ID zapisa; isti klijentski zapis nikad ne smije nastati dvaput.
  local_id     TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  payload      JSONB NOT NULL,
  -- Vrijeme nastanka na uređaju (UTC). Služi za konflikt, ne za watermark.
  client_at    TIMESTAMPTZ NOT NULL,
  -- Vrijeme prijema na serveru. Ovo je watermark osa za pull.
  server_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sync_items_identity_unique UNIQUE (company_id, user_id, device_id, local_id)
);

-- Pull: "sve moje izmjene poslije watermark-a", po firmi.
CREATE INDEX sync_items_pull_idx ON sync_items (company_id, server_at, id);
CREATE INDEX sync_items_user_idx ON sync_items (company_id, user_id, server_at);

ALTER TABLE sync_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sync_items
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

INSERT INTO schema_migrations (name) VALUES ('20261107130000_sync') ON CONFLICT DO NOTHING;

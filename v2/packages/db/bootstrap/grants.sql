-- Aplikacijska rola dobija tačno prava iz `preflight-checks/privilege-matrix.tsv`.
-- Pokreće se kao migrator/vlasnik nakon svih migracija i pri svakom deployu. Idempotentno.
--
-- Nikad GRANT ALL na sve tabele/sekvence: nov objekat nema pristup dok matrica nije
-- pregledana. Preflight pod DATABASE_URL provjerava efektivna prava (uključujući naslijeđena).
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gradix_app') THEN
    RAISE EXCEPTION 'Nedostaje rola gradix_app; prvo pokreni bootstrap/roles.sql.';
  END IF;
  IF current_user = 'gradix_app' THEN
    RAISE EXCEPTION 'grants.sql mora pokrenuti migrator/vlasnik, ne gradix_app.';
  END IF;
END
$$;

-- Ukloni istorijski široki ACL i javne pristupe; zatim se ispod dodaju samo prava iz matrice.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, gradix_app;
GRANT USAGE ON SCHEMA public TO gradix_app;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, gradix_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, gradix_app;

-- REVOKE ALL ON TABLE uklanja tabelna prava, ali zato eksplicitno ukloni i eventualne
-- column-level ACL-ove (SELECT/INSERT/UPDATE/REFERENCES) koje bi inače zaobišle matricu.
DO $$
DECLARE
  v_column RECORD;
BEGIN
  FOR v_column IN
    SELECT c.relname, a.attname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND a.attnum > 0
       AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON TABLE public.%2$I FROM PUBLIC, gradix_app',
      v_column.attname, v_column.relname
    );
  END LOOP;
END
$$;

-- Novе tabele i sekvence ostaju bez app ACL-a. Važi za DDL koji izvrši ova migracijska rola.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM gradix_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM gradix_app;

-- Tabele — tačno `needed` kolona iz privilege-matrix.tsv.
GRANT SELECT ON TABLE public.companies TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.users TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.memberships TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sessions TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.machines TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.audit_events TO gradix_app;
-- platform_users, schema_migrations, login_attempts: namjerno bez direktnih prava.
-- Cursor internals have no direct table ACL. Tenant-checked definer functions are the only
-- reservation/publish/sweep/pull path. `sync_change_log` is SELECT-only.
GRANT SELECT ON TABLE public.sync_change_log TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.invitations TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.password_resets TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.workers TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.equipment_categories TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.obligation_types TO gradix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.obligations TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.obligation_versions TO gradix_app;
-- F2: pravila „svaki X mora imati Y“ i kome ide podsjetnik.
-- Pravila se brišu: `DELETE /api/obligation-requirements/:id` postoji za pogrešno uneseno
-- pravilo, a deaktivacija bi ostavila „duh“ pravilo koje i dalje pravi nedostajuće obaveze.
-- `notify_roles` se NE briše kroz aplikaciju (samo se mijenja `role`), pa app rola nema DELETE.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.obligation_requirements TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.obligation_notify_roles TO gradix_app;
-- F3: kadrovska evidencija. Nijedna od ovih tabela se ne briše kroz aplikaciju:
-- satnica se zatvara novim redom, zaduženje povratom, historija i šabloni se ispravljaju
-- novim redom. `DELETE` bi bio tiha izmjena prošlosti (spec 04 §1.2.8, §1.4.17).
GRANT SELECT, INSERT, UPDATE ON TABLE public.worker_rates TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.worker_leave_entitlements TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.worker_issuances TO gradix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ppe_templates TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.worker_history TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.attachments TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.usage_overrides TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notifications TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_preferences TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_deliveries TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.projects TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.project_assignments TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.project_assignment_overrides TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.workdays TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.work_week_approvals TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.workday_revisions TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.work_entries TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.sync_receipts TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sync_conflicts TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.machine_work_logs TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.machine_meter_readings TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.machine_work_log_revisions TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.fuel_entries TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.fuel_entry_revisions TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.route_segments TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.hauls TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.haul_revisions TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.machine_daily_checks TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.machine_daily_check_revisions TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.partners TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.machine_faults TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.machine_fault_revisions TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.approval_requests TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.machine_cost_rates TO gradix_app;
-- F5 (Modul 6): jedinstveni ledger troškova zamjenjuje `project_cost_entries`.
-- `cost_entries` NEMA DELETE: storno je UPDATE na `REVERSED` + novi `POSTED` red, a triger
-- `cost_entry_guard()` brani prepisivanje iznosa i brisanje. Zato `SELECT;INSERT;UPDATE`.
GRANT SELECT, INSERT, UPDATE ON TABLE public.cost_entries TO gradix_app;
-- Šifarnik kategorija: OWNER mijenja naziv/redoslijed; zadana kategorija po tipu izvora je
-- djelimični unikat, pa izmjena `default_for_source_type` ide kroz UPDATE.
GRANT SELECT, INSERT, UPDATE ON TABLE public.cost_categories TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.project_phases TO gradix_app;
-- Zavisnosti faza se brišu (pogrešno unesena zavisnost nije istorijski podatak).
GRANT SELECT, INSERT, DELETE ON TABLE public.phase_dependencies TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.project_budget_lines TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.project_boq_items TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.project_amendments TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.project_tasks TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.task_comments TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.budget_alert_events TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.project_close_snapshots TO gradix_app;
-- F6 (Modul 7): obračun. Nijedan DELETE — period, obračun, linija i raspis su DOKAZ iznosa.
-- Ispravka je nova revizija (`payroll_runs.revision`), ne prepisivanje starih linija; triger
-- `payroll_freeze_guard()` brani UPDATE/DELETE linija i izvora čak i kad grant postoji.
GRANT SELECT, INSERT, UPDATE ON TABLE public.pay_periods TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payroll_components TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payroll_parameters TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payroll_runs TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.payroll_run_lines TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.payroll_line_sources TO gradix_app;
-- Akontacija se smanjuje (`remaining_cents`), ne briše; zato UPDATE, bez DELETE.
GRANT SELECT, INSERT, UPDATE ON TABLE public.worker_advances TO gradix_app;
-- Korekcija prelazi `OPEN → APPLIED`; zatvorena korekcija se ne briše.
GRANT SELECT, INSERT, UPDATE ON TABLE public.pay_corrections TO gradix_app;
-- F4 (Modul 5): razložen trošak mašine, gorivo, šabloni pregleda.
-- Komponente se NIKAD ne brišu — nova vrijednost je novi red, stari dobija `valid_to`
-- (spec 05 §1.1.3). Zato nema DELETE: brisanje bi tiho promijenilo već proknjižene troškove,
-- koji su zaštićeni snapshotom u `project_cost_entries`.
GRANT SELECT, INSERT, UPDATE ON TABLE public.machine_cost_components TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.machine_cost_rate_snapshots TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.fuel_prices TO gradix_app;
-- Cisterna: `current_l` se mijenja pri svakom točenju i popisu; brisanje nije predviđeno
-- (deaktivacija je UPDATE).
GRANT SELECT, INSERT, UPDATE ON TABLE public.fuel_tanks TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.check_templates TO gradix_app;
-- Modul 8 puni nalog; u F4 se otvara automatski iz kvara i nosi trošak na projekat.
GRANT SELECT, INSERT, UPDATE ON TABLE public.service_orders TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tenders TO gradix_app;
-- F7 (Modul 8): tenderi — predmjer i resursi se mijenjaju (stavka se briše dok je tender otvoren);
-- revizije cijene su append-only (UPDATE samo za odobrenje, brani triger); ishod se NE mijenja
-- (jedan po tenderu, zapis odluke); checklista se ažurira (status, prilog, povrat garancije).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tender_boq_items TO gradix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tender_resources TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tender_price_revisions TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tender_checklist_templates TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tender_checklist_items TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.tender_outcomes TO gradix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tender_phases TO gradix_app;
GRANT SELECT, INSERT, DELETE ON TABLE public.tender_team TO gradix_app;
-- F1: jezgro firme i sigurnost pristupa (spec 01).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_holidays TO gradix_app;
GRANT SELECT, INSERT, DELETE ON TABLE public.password_history TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_totp TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_recovery_codes TO gradix_app;
GRANT SELECT ON TABLE public.platform_support_sessions TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_templates TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.report_jobs TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.daily_rollups TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_devices TO gradix_app;
-- No direct sequence rights; login_attempts_id_seq is used only by its definer function.

-- App-callable lookup and rate-limit functions. Revoke default PUBLIC EXECUTE first; these
-- functions are the only deliberate exceptions to direct table access in the login path.
REVOKE ALL ON FUNCTION public.auth_memberships(TEXT) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.auth_memberships(TEXT) TO gradix_app;
REVOKE ALL ON FUNCTION public.auth_session_by_hash(TEXT) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.auth_session_by_hash(TEXT) TO gradix_app;

-- Cursor functions are narrow tenant APIs; each compares its tenant argument with app.company_id.
REVOKE ALL ON FUNCTION public.sync_cursor_reserve(TEXT, TEXT, INTEGER) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.sync_cursor_reserve(TEXT, TEXT, INTEGER) TO gradix_app;
REVOKE ALL ON FUNCTION public.sync_cursor_reserve_item(TEXT, TEXT, INTEGER) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.sync_cursor_reserve_item(TEXT, TEXT, INTEGER) TO gradix_app;
REVOKE ALL ON FUNCTION public.sync_cursor_skip(TEXT, BIGINT, TEXT) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.sync_cursor_skip(TEXT, BIGINT, TEXT) TO gradix_app;
REVOKE ALL ON FUNCTION public.sync_cursor_publish(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, BIGINT, JSONB, BOOLEAN) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.sync_cursor_publish(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, BIGINT, JSONB, BOOLEAN) TO gradix_app;
REVOKE ALL ON FUNCTION public.sync_cursor_sweep(TEXT, INTEGER) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.sync_cursor_sweep(TEXT, INTEGER) TO gradix_app;
REVOKE ALL ON FUNCTION public.sync_cursor_pull(TEXT, BIGINT, INTEGER) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.sync_cursor_pull(TEXT, BIGINT, INTEGER) TO gradix_app;

REVOKE ALL ON FUNCTION public.login_attempt_record(TEXT, TEXT, INTEGER) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.login_attempt_record(TEXT, TEXT, INTEGER) TO gradix_app;
REVOKE ALL ON FUNCTION public.login_attempt_count(TEXT, INTEGER) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.login_attempt_count(TEXT, INTEGER) TO gradix_app;
REVOKE ALL ON FUNCTION public.login_attempt_clear(TEXT) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.login_attempt_clear(TEXT) TO gradix_app;
REVOKE ALL ON FUNCTION public.login_attempt_retry_after(TEXT, INTEGER) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.login_attempt_retry_after(TEXT, INTEGER) TO gradix_app;

-- Trigger helpers run through their trigger, never by direct app invocation.
REVOKE ALL ON FUNCTION public.companies_seed_equipment_categories() FROM PUBLIC, gradix_app;
REVOKE ALL ON FUNCTION public.companies_seed_obligation_types() FROM PUBLIC, gradix_app;
REVOKE ALL ON FUNCTION public.guard_project_assignment_history() FROM PUBLIC, gradix_app;
REVOKE ALL ON FUNCTION public.reject_project_assignments_truncate() FROM PUBLIC, gradix_app;
REVOKE ALL ON FUNCTION public.guard_workday_identity() FROM PUBLIC, gradix_app;
REVOKE ALL ON FUNCTION public.guard_work_entry_overlap() FROM PUBLIC, gradix_app;
REVOKE ALL ON FUNCTION public.guard_sync_receipt_update() FROM PUBLIC, gradix_app;
REVOKE ALL ON FUNCTION public.guard_sync_conflict_update() FROM PUBLIC, gradix_app;
REVOKE ALL ON FUNCTION public.guard_machine_work_log_overlap() FROM PUBLIC, gradix_app;
REVOKE ALL ON FUNCTION public.guard_machine_meter_reading_insert() FROM PUBLIC, gradix_app;

-- The R3 overlap helper exists only on the no-btree_gist trigger fallback.
DO $$
BEGIN
  IF to_regprocedure('public.project_assignment_no_overlap()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.project_assignment_no_overlap() FROM PUBLIC, gradix_app';
  END IF;
END
$$;

-- F4 (Modul 5) trigger helperi. Istup isti kao gore: bez EXECUTE-a za app rolu, jer bi
-- direktan poziv zaobišao red-triger (a time i tenant RLS put i poruku greške koju servis hvata).
DO $$
DECLARE
  v_funkcija TEXT;
BEGIN
  FOREACH v_funkcija IN ARRAY ARRAY[
    -- Postoji samo na fallback-u bez `btree_gist`: preklapanje komponenti stope.
    'public.machine_cost_component_no_overlap()',
    'public.project_cost_snapshot_immutable()',
    'public.check_templates_items_guard()',
    'public.machine_daily_checks_checklist_guard()',
    -- Uvijek postoji: globalna zabrana dvostruke dodjele mašine.
    'public.project_assignment_machine_global_guard()',
    -- APPROVED kvar otvara servisni nalog; direktan poziv bi zaobišao tok.
    'public.machine_fault_open_service_order()',
    -- F5: ledger i revizije budžeta su append-only; direktan poziv bi zaobišao te provjere.
    'public.cost_entry_guard()',
    'public.budget_line_immutable()',
    'public.seed_cost_categories(TEXT)',
    'public.companies_seed_cost_categories()'
  ] LOOP
    IF to_regprocedure(v_funkcija) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, gradix_app', v_funkcija);
    END IF;
  END LOOP;
END
$$;

COMMIT;

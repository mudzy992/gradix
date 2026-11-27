# Faza 0 — provjeren inventar Gradix weba

**Snimak:** 2026-11-27 · **Radna grana:** `arena/7b5ea9bf-gradix` · **HEAD pri pregledu:** `e7a37910a9c0a651d3d77a059592d755330b399c` · **Status stabla prije artefakata:** čisto.

Ovo je mapa prisutnih putanja i vlasništva, ne završetak audita. Ne tvrdi da su funkcije potpune, migracije primijenjene, testovi prolazni, deploy produkcijski ili pregled vlasnika obavljen. Mobilni izvorni kod nije inventarisan niti testiran.

## 1. Moduli: UI, API, servisi, domena, baza, worker i testni ankeri

Putanje `/**` označavaju route groups sa dinamičkim listovima. `Server` nazivi su fajlovi u `v2/apps/web/src/server`, domena u `v2/packages/domain/src`; testna imena su u `v2/apps/web/src/server` ako nije označeno `UI` (app testovi), `domain`, `DB` (`v2/packages/db/src`) ili `worker` (`v2/apps/worker/src`). Testni anker znači samo da fajl postoji; u Fazi 0 nisu pokretani testovi.

### 01 — Firma, pristup, role, audit i sesije (spec 01)
- **Web:** `/login`, `/lozinka/postavi`, `/lozinka/promjena`, `/platform`, `/platform/login`, `/platform/firme`, `/platform/firme/nova`, `/ured/postavke`, `/ured/korisnici`, `/ured/role`, `/ured/audit`, `/ured/profil`, `/ured/profil/sesije`; `/nemate-pristup` je implementiran kao `route.ts`, ne `page.tsx`. `/` je ulazna/redirect putanja.
- **API:** `/api/auth/**` (uključuje 2FA i passkeys), `/api/company/**`, `/api/users/**`, `/api/invitations/**`, `/api/password-resets/**`, `/api/roles`, `/api/platform/**`, `/api/audit`, `/api/me`, `/api/me/sessions/**`.
- **Server:** `auth-service.ts`, `auth-lookup.ts`, `access-service.ts`, `company-service.ts`, `platform-service.ts`, `session-service.ts`, `tenant-context.ts`, `rbac-service.ts`, `permissions.ts`, `audit.ts`, `two-factor.ts`, `passkey-*`, `password.ts`.
- **Domena:** `auth.ts`, `sessions.ts`, `totp.ts`, `password-policy.ts`; tenant scope dijele i drugi moduli.
- **Tabele:** `companies`, `company_holidays`, `users`, `memberships`, `sessions`, `invitations`, `password_resets`, `login_attempts`, `password_history`, `user_totp`, `user_recovery_codes`, `user_passkeys`, `webauthn_challenges`, `platform_users`, `platform_sessions`, `platform_support_sessions`, `audit_events`. `user_devices` i notification tabele se vode pod modulom 12; `attachments` je zajednički servis. Passkeys migracije su datirane poslije snimka (vidi §3.5).
- **Worker:** nema posla samo za modul 1; `notifications.deliver` je zajednička isporuka.
- **Testni ankeri:** server `f1-access.integration.test.ts`, `access.integration.test.ts`, `rbac.integration.test.ts`, `two-factor-lifecycle.integration.test.ts`, `two-factor-app-role.integration.test.ts`, `passkeys.integration.test.ts`, `tenant-context.test.ts`; DB `passkeys-rls.integration.test.ts`, `f11-foundation-migration.integration.test.ts`; UI `users-client`, `postavke-client`, `sigurnost-tab`, `roles-client`, `audit-client`, `passkeys`.

### 02 — Obaveze s rokom (spec 02)
- **Web:** `/ured/rokovi`.
- **API:** `/api/obligations/**` (uključujući import/export, priloge, renew/review/correct i missing), `/api/obligation-types/**`, `/api/obligation-requirements/**`, `/api/me/blockers`.
- **Server:** `obligation-service.ts`, `obligation-scope.ts`, `obligation-requirement-service.ts`, `obligation-export-service.ts`, `obligation-import-service.ts`, `attachment-service.ts` (zajednički).
- **Domena:** `obligations.ts`, `can-use-entity.ts` (blokade se koriste i u drugim modulima).
- **Tabele:** `obligation_types`, `obligations`, `obligation_versions`, `obligation_requirements`, `obligation_notify_roles`; `attachments` je zajednička.
- **Worker:** `reminders.scan` (rokovi), `attachments.purge` (retencija priloga).
- **Testni ankeri:** `obligations.integration.test.ts`, `obligation-requirement.integration.test.ts`, `obligation-scoped-flows.integration.test.ts`, `obligation-isolation.integration.test.ts`, `obligation-attachment-register.integration.test.ts`; UI `obligations-client.test.tsx`, `missing-panel.test.tsx`.

### 03 — Radno vrijeme i sinhronizacija (spec 03)
- **Web:** `/ured/radni-dani`, `/ured/radni-dani/sedmica`, `/ured/sukobi`, `/ured/sukobi/[id]`.
- **API:** `/api/workdays/**`, `/api/work-weeks/**`, `/api/workday-conflicts/**`, `/api/sync/**`, `/api/sync/foreman-workers`, `/api/me/day`.
- **Server:** `workday-timer-service.ts`, `workday-my-day.ts`, `workday-review.ts`, `workday-approval.ts`, `workday-resolve.ts`, `workday-week.ts`, `workday-week-actions.ts`, `sync-cursor.ts`, `sync-workday-scope.ts`, `r4-sync-*`.
- **Domena:** `workdays.ts`, `r4-sync.ts`, `assignments.ts` (zajedničke provjere).
- **Tabele:** `workdays`, `work_entries`, `work_week_approvals`, `workday_revisions`, `sync_receipts`, `sync_conflicts`, `sync_change_log`, `sync_cursor_allocators`, `sync_cursor_slots`.
- **Worker:** `sync.purge` čisti retenciju sync zapisa; opseg posla je zajednički.
- **Testni ankeri:** server `phase3.integration.test.ts`, `workday-review.integration.test.ts`, `workday-approval.integration.test.ts`, `workday-approval-gates.integration.test.ts`, `workday-resolve.integration.test.ts`, `sync-workday-scope.integration.test.ts`, `workday-timer-cost.integration.test.ts`; DB `r4-workday.integration.test.ts`, `sync-cursor.integration.test.ts`; UI `week-client.test.ts`, `review-label.test.ts`, `conflict-detail-client.test.tsx`.

### 04 — Radnici (spec 04)
- **Web:** `/ured/radnici`, `/ured/radnici/[id]`.
- **API:** `/api/workers/**`, `/api/ppe-templates/**`; worker import je dio zajedničkog `/api/imports/**`.
- **Server:** `worker-service.ts`; import logika u `import-service.ts`/pomoćnim `import-*` fajlovima dijeli se s modulima 5 i 6.
- **Domena:** u trenutnom `packages/domain/src` nema zasebnog `workers.ts`; evidencija radnika je u `worker-service.ts`, a `workdays.ts`/`assignments.ts` su susjedni domenski modeli.
- **Tabele:** `workers`, `worker_rates`, `worker_leave_entitlements`, `worker_issuances`, `ppe_templates`, `worker_history`; `memberships/users` su modul 1, radni zapisi modul 3.
- **Worker:** nije utvrđen zaseban posao za ovaj modul.
- **Testni ankeri:** `phase3.integration.test.ts`, `scope-roles.integration.test.ts`; UI `workers-client.test.tsx`, `worker-detail-client.test.tsx`.

### 05 — Mehanizacija (spec 05)
- **Web:** `/ured/masine`, `/ured/masine/[id]`, `/ured/masine/kalendar`, `/ured/sati-masine`, `/ured/ture`, `/ured/gorivo`, `/ured/kvarovi`, `/ured/dnevni-pregled`, `/ured/trosak-masina`.
- **API:** `/api/equipment/**`, `/api/equipment-categories`, `/api/machines/**` (dio maintenance ruta je modul 9), `/api/machine-work-logs/**`, `/api/machine-faults/**`, `/api/machine-daily-checks/**`, `/api/fuel-entries/**`, `/api/fuel-prices`, `/api/fuel-tanks/**`, `/api/hauls/**`, `/api/route-segments`, `/api/machine-cost-rates`, `/api/calendar/availability`; mašinski import je u `/api/imports/**`.
- **Server:** `equipment-service.ts`, `equipment-scope.ts`, `machine-availability-service.ts`, `machine-cost-component-service.ts`, `machine-cost-rate-service.ts`, `machine-utilization-service.ts`, `machine-reliability-service.ts`, `machine-work-log-*`, `machine-fault-*`, `fuel-entry-*`, `fuel-price-service.ts`, `haul-*`, `route-segment-service.ts`, `daily-check-*`, `check-template-service.ts`, `r4-sync-*`.
- **Domena:** `machine-cost.ts`, `machine-cost-components.ts`, `assignments.ts`, `can-use-entity.ts`, `r5-*sync.ts`.
- **Tabele:** `machines`, `equipment_categories`, `machine_cost_components`, `machine_cost_rates`, `machine_cost_rate_snapshots`, `machine_meter_readings`, `machine_work_logs`, `machine_work_log_revisions`, `fuel_entries`, `fuel_entry_revisions`, `fuel_prices`, `fuel_tanks`, `route_segments`, `hauls`, `haul_revisions`, `machine_daily_checks`, `machine_daily_check_revisions`, `machine_faults`, `machine_fault_revisions`, `usage_overrides`; `approval_requests`, `attachments` and cost ledger are shared/owned elsewhere.
- **Worker:** attachment purge is shared. `reminders.scan` includes maintenance plans (module 9), not a separately identified machinery job.
- **Testni ankeri:** server `equipment.integration.test.ts`, `equipment-isolation.integration.test.ts`, `equipment-scope.integration.test.ts`, `phase4.integration.test.ts`, `machine-fault.integration.test.ts`, `machine-work-log.integration.test.ts`, `fuel-entry.integration.test.ts`, `fuel-price.integration.test.ts`, `haul.integration.test.ts`, `daily-check.integration.test.ts`; DB `r5-daily-checks.integration.test.ts`, `r5-faults.integration.test.ts`, `r5-fuel-entries.integration.test.ts`, `r5-hauls.integration.test.ts`, `r5-machine-work-log.integration.test.ts`; UI `equipment-client.test.tsx`, `faults-dashboard.test.tsx`.

### 06 — Projekti, budžet i troškovi (spec 06)
- **Web:** `/ured/projekti`, `/ured/projekti/[id]`, `/ured/zadaci`, `/ured/postavke/kategorije-troska`, `/ured/uvoz`.
- **API:** `/api/projects/**`, `/api/projects/export`, `/api/tasks/**`, `/api/costs` i `/api/costs/[id]/reverse`, `/api/cost-categories`, `/api/imports/**` (vrste `projects`; uvoz radnika/opreme dijele se s 04/05). Generički `/api/attachments/**` ostaje zajednički.
- **Server:** `project-service.ts`, `project-phase-service.ts`, `project-budget-service.ts`, `project-finance-service.ts`, `cost-entry-service.ts`, `task-service.ts`, `task-scope.ts`, `import-service.ts`, `import-projects.ts`, `import-project-write.ts`, `manual-cost-approval-service.ts` (ručni zahtjev je modul 11).
- **Domena:** `projects.ts`, `money.ts`, `assignments.ts`, `attachments.ts`.
- **Tabele:** `projects`, `project_assignments`, `project_assignment_overrides`, `project_phases`, `phase_dependencies`, `project_budget_lines`, `project_amendments`, `project_boq_items`, `project_tasks`, `task_comments`, `project_close_snapshots`, `cost_categories`, `cost_entries`, `budget_alert_events`. `cost_entries` je jedini ledger; dodatni moduli su njegovi izvori.
- **Worker:** `budget.thresholds`; rollup i izvještaji su servis modula 12.
- **Testni ankeri:** server `projects.integration.test.ts`, `project-isolation.integration.test.ts`, `project-cost.integration.test.ts`, `project-close-storno.integration.test.ts`, `task-scope.integration.test.ts`, `task-service.test.ts`, `import.integration.test.ts`, `import-isolation.integration.test.ts`, `journey-a-project-lifecycle.integration.test.ts`; DB `r6-costs.integration.test.ts`; UI `projects-client`, `project-overview`, `project-costs`, `project-tasks-dashboard`, `import-client`.

### 07 — Obračun sati i troška rada (spec 07)
- **Web:** `/ured/obracun-sati`, `/ured/obracun-sati/[period]`, `/ured/obracun-sati/postavke`, `/ured/obracun-sati/sati`; kartica radnika ima tab obračuna.
- **API:** `/api/pay-periods/**`, `/api/payroll/**`, `/api/workers/[id]/advances`, `/api/payroll/corrections`, `/api/payroll/lines/[id]/sources`, `/api/me/payroll`.
- **Server:** `payroll-period-service.ts`, `payroll-export.ts`, `payroll-reminder.ts`.
- **Domena:** `payroll-hours.ts`.
- **Tabele:** `pay_periods`, `payroll_components`, `payroll_parameters`, `payroll_runs`, `payroll_run_lines`, `payroll_line_sources`, `worker_advances`, `pay_corrections`; sati i satnice su izvori iz modula 3/4.
- **Worker:** nije utvrđen poseban payroll posao; podsjetnik se poziva iz web pregleda.
- **Testni ankeri:** server `payroll-period.integration.test.ts`, `payroll-reminder.test.ts`, domain `payroll-hours.test.ts`; DB `sweep2b-advance-migration.integration.test.ts`; UI `payroll-ui.test.ts`, `hours-export-client.test.tsx`.

### 08 — Tenderi (spec 08)
- **Web:** `/ured/tenderi`, `/ured/tenderi/[id]`, `/ured/tenderi/kalendar`, `/ured/tenderi/uspjesnost`.
- **API:** `/api/tenders/**`, `/api/tenders/export`, `/api/tender-checklist-templates`, `/api/tenders/[id]/attachments/**`.
- **Server:** `tender-service.ts`, `tender-pricing.ts`, `tender-checklist-service.ts`, `tender-outcome-service.ts`, `tender-copy.ts`, `tender-convert.ts`, `tender-team-service.ts`, `tender-calendar-service.ts`, `tender-attachment-service.ts`, `tender-status.ts`.
- **Domena:** `tender-calculation.ts`, `can-use-entity.ts`.
- **Tabele prisutne u `schema.generated.ts`:** `tenders`, `tender_boq_items`, `tender_resources`, `tender_price_revisions`, `tender_checklist_templates`, `tender_checklist_items`, `tender_outcomes`, `tender_phases`, `tender_team`; tender scope je proširen i u `obligations`. Prilozi koriste zajednički `attachments`.
- **Worker:** `reminders.scan` učitava tender rokove preko `obligations.tender_id`; tenderi su i izvori izvještaja modula 12.
- **Testni ankeri:** `tender-lifecycle.integration.test.ts`, `tender-convert.integration.test.ts`, `tender-convert-race.integration.test.ts`, `tender-pricing.integration.test.ts`, `tender-status.test.ts`; UI `tenders-export.test.tsx`.
- **Neslaganje za provjeru u auditu:** `STATUS.md` i `IZVJESTAJ-FAZA-7.md` navode `tender_calculation_items` i `tender_price_approvals` kao isporučene. Pretraga trenutne migracije/schema/koda ne nalazi te objekte; migracija/schema sadrži `tender_price_revisions` (u kojem postoje polja odobrenja). Ne zaključujem iz ovoga da je poslovni tok neispravan; status i namjeru treba provjeriti u auditu modula 8.

### 09 — Servis i održavanje (spec 09)
- **Web:** `/ured/servis`, `/ured/servis/[id]`, `/ured/servis/planovi`, `/ured/dijelovi`; tab održavanja na `/ured/masine/[id]`.
- **API:** `/api/service-orders/**`, `/api/maintenance-templates/**`, `/api/machines/[id]/maintenance/**`, `/api/machines/[id]/reliability`, `/api/stock-items/**`, `/api/stock-movements` (minimalni stock model je uveden ovdje, kasnije proširen u 11).
- **Server:** `service-order-service.ts`, `service-order-actions.ts`, `service-order-read.ts`, `service-order-transaction.ts`, `service-order-sync-actions.ts`, `service-part-stock.ts`, `service-cost-component.ts`, `service-order-downtime.ts`, `maintenance-service.ts`, `stock-service.ts`, `service-attention.ts`, `r4-sync-service-order.ts`.
- **Domena:** `service-maintenance.ts`, `service-order-sync.ts`.
- **Tabele:** `service_orders`, `service_order_events`, `service_order_parts`, `maintenance_templates`, `maintenance_plans`, `stock_items`, `stock_movements`; koristi i `machine_faults`, `approval_requests`, `cost_entries` bez preuzimanja njihovog vlasništva.
- **Worker:** `reminders.scan` računa preventivne planove i otvara naloge.
- **Testni ankeri:** `f8-service-orders.integration.test.ts`, `f8-service-sync.integration.test.ts`, `f8-isolation.integration.test.ts`, `service-maintenance.test.ts`, `service-order-sync.test.ts`; UI `servis-dashboard.test.tsx`, `odrzavanje-client.test.tsx`.

### 10 — Dnevnik građenja i HSE (spec 10)
- **Web:** `/ured/dnevnik`, `/ured/dnevnik/[id]`, `/ured/hse`, `/ured/hse/[id]`, `/ured/hse/inspekcije`, `/ured/hse/obuke`.
- **API:** `/api/site-diaries/**`, `/api/site-diary-templates`, `/api/hse/**` (incidents, photos, updates, actions, inspections, trainings, roster, stats, export/PDF).
- **Server:** `diary-service.ts`, `diary-template-service.ts`, `diary-pdf-service.ts`, `hse-service.ts`, `hse-scope.ts`, `hse-photo-service.ts`, `hse-report-pdf-service.ts`, `r6-sync-diary.ts`, `r6-sync-hse.ts`.
- **Domena:** `site-diary-hse.ts`, `r6-diary-hse-sync.ts`.
- **Tabele:** `site_diaries`, `site_diary_items`, `site_diary_revisions`, `site_diary_delays`, `site_diary_templates`, `site_diary_attachments`, `hse_incidents`, `hse_incident_workers`, `hse_incident_updates`, `hse_investigations`, `hse_actions`, `hse_inspections`, `hse_trainings`, `hse_training_attendees`, `hse_attachments`.
- **Worker:** specifikacija 12 navodi HSE mjere u `reminders.scan`; pregled `reminders-scan.ts` u ovoj fazi ne nalazi HSE akcije.
- **Testni ankeri:** server `f9-diary-hse.integration.test.ts`, `f9-sync.integration.test.ts`, domain `site-diary-hse.test.ts`, `r6-diary-item-sync.test.ts`; DB `f9-incident-workers-migration.integration.test.ts`. App-level UI test za dnevnik/HSE nije vidljiv u `src/app/**/*.test.*` osim HSE exporta — provjeriti šire u auditu.

### 11 — Skladište, nabavka, partneri i podizvođači (spec 11)
- **Web:** `/ured/skladiste`, `/ured/nabavka`, `/ured/partneri`, `/ured/podizvodjaci`.
- **API:** `/api/warehouses/**`, `/api/stock-items/**`, `/api/stock/**`, `/api/stock-movements`, `/api/stock-transfers`, `/api/stock-counts/**`, `/api/purchase-requests/**`, `/api/purchase-orders/**`, `/api/goods-receipts`, `/api/purchase-invoices/**`, `/api/material-issues`, `/api/partners/**`, `/api/subcontractor-contracts/**`, `/api/subcontractor-statements/**`, `/api/costs/manual/**`.
- **Server:** `warehouse-service.ts`, `stock-service.ts`, `stock-count-service.ts`, `goods-receipt-service.ts`, `purchase-request-service.ts`, `purchase-order-service.ts`, `purchase-invoice-service.ts`, `purchase-reclassification.ts`, `purchase-response.ts`, `material-issue-service.ts`, `partner-service.ts`, `partner-role-service.ts`, `subcontract-contract-service.ts`, `subcontract-statement-service.ts`, `manual-cost-approval-service.ts`.
- **Domena:** `warehouse-purchase.ts`.
- **Tabele:** `partners`, `partner_roles`, `warehouses`, `stock_items`, `stock_movements`, `stock_item_levels`, `stock_counts`, `stock_count_items`, `purchase_requests`, `purchase_request_items`, `purchase_orders`, `purchase_order_items`, `goods_receipts`, `goods_receipt_items`, `purchase_invoices`, `purchase_invoice_items`, `material_issues`, `material_issue_items`, `material_issue_allocations`, `subcontractor_contracts`, `subcontractor_contract_amendments`, `subcontractor_statements`, `subcontractor_statement_items`, `manual_cost_requests`; `cost_entries` pripada centralnom ledgeru modula 6.
- **Worker:** nije utvrđen poseban F10 posao; prilozi/notifikacije/reporting su zajednički.
- **Testni ankeri:** server `f10-partner-roles.integration.test.ts`, `f10-purchase-request.integration.test.ts`, `f10-subcontract-manual.integration.test.ts`, `f10-warehouse.integration.test.ts`; DB `f10-partner-roles.integration.test.ts`, `f10-purchase-material.integration.test.ts`, `f10-subcontract-manual-migration.integration.test.ts`, `f10-warehouse-migration.integration.test.ts`; domain `warehouse-purchase.test.ts`; UI `warehouse-client.test.tsx`, `purchase-client.test.tsx`, `purchase-forms.test.tsx`, `subcontract-client.test.tsx`.

### 12 — Pregled, izvještaji, obavještenja i pretraga (spec 12)
- **Web:** `/pregled`, `/ured/akcije`, `/ured/izvjestaji`, `/ured/obavjestenja`.
- **API:** `/api/pregled`, `/api/dashboard/**`, `/api/data-health`, `/api/search`, `/api/reports/[key]`, `/api/report-jobs/**`, `/api/notifications/**`, `/api/health`, `/api/health/queue`, `/api/ready`.
- **Server:** `pregled-service.ts`, `dashboard-*`, `data-health*`, `global-search.ts`, `report-*`, `report-job-*`, `notification-service.ts`, `notification-hrefs.ts`, `queue-health.ts`, `worker-overview.ts`.
- **Domena:** `report-definitions.ts`; zajedničke brojke i scope dolaze iz modula koji posjeduju podatke.
- **Tabele:** `notifications`, `notification_preferences`, `notification_deliveries`, `notification_templates`, `report_jobs`, `daily_rollups`, `user_devices`; generički prilog je `attachments`.
- **Worker registrovan u `apps/worker/src/main.ts`:** `ping.health`, `notifications.deliver`, `reminders.scan`, `attachments.purge`, `sync.purge`, `budget.thresholds`, `rollup.nightly`, `reports.scheduled`, `report_jobs`. Rasporedi u `main.ts`: ping prema konfigurisanom intervalu; reminders i budget svakih 15 min (reminders šalje samo u 06 h lokalnog vremena firme); attachments svakog dana 03:00 UTC; sync purge 03:30 UTC; rollup 02:00 UTC; scheduled reports svaki sat; `report_jobs` svake minute. `notifications.deliver` se šalje kao posao po firmi, nije cron raspored. Registracija/raspored u stablu ne dokazuju produkcijsku konfiguraciju ni stvarnu isporuku emaila.
- **Testni ankeri:** server `pregled-service.integration.test.ts`, `pregled-perf.integration.test.ts`, `data-health.integration.test.ts`, `notification.integration.test.ts`, `report-job-execution.integration.test.ts`, `report-job-flow.integration.test.ts`, `report-job-read.integration.test.ts`, `report-job-permissions.test.ts`, `report-render.test.ts`; DB `report-tenant-transaction.integration.test.ts`; worker `company-ids.integration.test.ts`, `reports-scheduled.test.ts`, `report-job-dispatch.integration.test.ts`; UI `pregled-board`, `role-dashboard`, `action-list-view`, `reports-client` testovi.

## 2. Zajedničke putanje i dodjela vlasništva

| Putanja/površina | Dodjela i granica |
|---|---|
| `attachments` i `/api/attachments/**` | Zajednička osnova modula 1; entitet/prilog pripada modulu koji posjeduje zapis. Specifične rute za obaveze, mašine, tendere, dnevnik/HSE ostaju kod svog modula. |
| `/api/me`, `/api/me/day`, `/api/me/blockers`, `/api/me/payroll`, `/api/me/sessions/**` | Redom modul 1, 3, 2, 7 i 1; zajednički prefiks nije zajedničko vlasništvo. |
| `/api/sync/**` | Sync jezgro modula 3; payload konektori za mehanizaciju, servis i dnevnik/HSE pripadaju modulima 5/9/10. Ne inventarisati `apps/mobile` po korisnikovom opsegu. |
| `/ured/uvoz`, `/api/imports/**` | Jedan UX/servis za `workers`, `equipment`, `projects`; modul 6 kao okvir, vlasnici podataka 4/5/6. Partneri nisu među trenutno podržanim `ImportKind` vrijednostima. |
| `cost_entries`, `/api/costs/manual/**` | `cost_entries` ledger je modul 6; manual request/approval endpointi su modul 11 i ne smiju praviti drugi ledger. |
| `stock_items`, `stock_movements`, `/api/stock-*` | Osnovni servisni dijelovi u modulu 9; skladište/više skladišta/popisi/nabavka se proširuju u modulu 11. Isto ime tabele ne znači dva vlasnika stanja. |
| `/api/partners/**` | Katalog i višestruke uloge modul 11; tenderi, servis i projekti su potrošači/veze. |
| `/api/dashboard/risky-projects`, `/api/pregled` | Modul 12 prikazuje; projekti/ledger su izvor u modulu 6. |
| `/api/health`, `/api/ready`, `/api/health/queue` | Runtime/operativna površina: health i readiness su infrastruktura; queue pregled je modul 12. |
| `/katalog` | Razvojni UI katalog, nije poslovni modul; `v2/apps/web/src/components/ui/catalog.tsx`. |
| `/nemate-pristup` | Zasebni route handler u modulu 1, ne `page.tsx`; ne propušta se iz inventara samo zato što nije standardna stranica. |

## 3. Nalazi dokumentacija–kod i ograničenja snimka

1. **F10 / `STATUS.md` / `pilot-ready`:** vlasnikov radni nalog kaže da je F10 isporučena na `pilot-ready`, ali `v2/docs/STATUS.md` (§ „Faza 10 — početak“) kaže „nije isporučena“. U aktivnom kodnom stablu postoje migracije `20261127100000_f10_partner_roles` do `20261127130000_f10_subcontract_manual`, web `/ured/skladiste`, `/ured/nabavka`, `/ured/partneri`, `/ured/podizvodjaci`, F10 servisi i `f10-*` integracijski testovi. To dokazuje prisutnost koda/testnih fajlova, ne prolaz, primjenu migracija, pilot deploy niti vlasnikov pregled uživo. `git ls-remote --heads origin pilot-ready` nije vratio ref, a `gh api repos/mudzy992/gradix/branches/pilot-ready` vratio je 404; posebna referenca zato nije mogla biti potvrđena. Inventar je vezan za aktivni branch/snimak naveden iznad.
2. **F7 tabele:** `STATUS.md` i `IZVJESTAJ-FAZA-7.md` navode `tender_calculation_items` i `tender_price_approvals`; trenutna F7 migracija i `schema.generated.ts` ne prikazuju te tabele, a `rg` ih nalazi samo u dokumentima. Revizija ponude ima polja odobrenja u `tender_price_revisions`. Ovo je dokumentacijski nesklad za audit modula 8, ne presuda o ispravnosti toka.
3. **Odobrenje C.1 dizajna:** `v2/docs/design/DESIGN.md` (§ C.1) kaže „prijedlog, čeka odobrenje“, dok `v2/docs/design/reference.html#c1-pregled-reference` kaže „Odobreno 2026-11-12 · implementirano“, a `/pregled` implementira taj prikaz. Potrebna je vlasnikova potvrda koji status važi. Korisnikov komentar o priloženom primjeru (sviđa mu se kartica Pregleda, njen sadržaj i koncept) bilježimo kao dizajnersku preferenciju; mobilne preglede iz tog primjera u ovom programu zanemarujemo.
4. **M12 podsjetnici:** spec 12 §1.3 navodi HSE mjere i tenderske garancije u `reminders.scan`. Pregled `v2/apps/worker/src/reminders-scan.ts` prikazuje obradu obaveza i maintenance planova; pretraga te datoteke nije našla HSE akcije ili `tender_checklist_items` garancije. Provjeriti u auditu modula 10/12; ne tvrditi da je worker zadatak potpun samo zato što je naziv registrovan.
5. **Datumi migracija:** u trenutnom stablu postoje migracije `20261128100000` nadalje, uključujući `20261201...`, poslije datuma snimka 2026-11-27. Zabilježiti hronologiju i vlasnikovo objašnjenje prije primjene; ne proglašavati greškom bez provjere.
6. **Dokumentacijska granica:** `wc -l v2/docs/STATUS.md` vraća 544 linije; postojeće pravilo u `v2/AGENTS.md` je najviše 100. Ne skraćivati STATUS u Fazi 0 mimo dogovorenih deliverablea.
7. **Kvalitet:** `v2/quality/parity/tender-matrix.mjs` parsira aktivnu tender matricu; `quality/registry` sadrži application/slice i R7 registre, ne izvršnu matricu za svih 12 modula. `slices.json` zadržava `R1.tenant.tables-through-r2` kao `NOT_IMPLEMENTED`, `gate: track`. Kvalitetni checker-i nisu pokrenuti u Fazi 0.
8. **Testi/provjera:** fajlovi su inventarisani, ne izvršeni. Komande `pnpm test`, `pnpm typecheck`, `pnpm lint`, a11y, build, DB preflight i deployment nisu pokretani u ovom prolazu. Broj inventarisanih testnih fajlova je broj fajlova, nikad broj prolaznih testova.
9. **Prilozi tendera:** `tender_attachments` se pojavljuje u historijskoj migraciji i starijim dokumentima; F0.2 je uveo objedinjeni `attachments`, koji koriste trenutni tender servis/rute. Zabilježiti mogući docs–code drift i migracijsku namjeru u auditu modula 8; to nije samo po sebi potvrđen kvar.

## 4. Metoda i komande za reprodukciju inventara

Pregledan je aktivni branch bez mijenjanja koda: `git status --short --branch`, `git log -1`, `find v2/apps/web/src/app -name page.tsx`, `find v2/apps/web/src/app/api -name route.ts`, popis `v2/apps/web/src/server`, `v2/packages/domain/src`, `v2/packages/db/migrations`, `schema.generated.ts`, worker `main.ts`/`jobs.ts`, testnih fajlova, `v2/quality/registry` i `rg` provjere navedenih simbola/neslaganja. Pri snimku: 171 web vitest/integration test fajl, 23 domain, 20 DB, 2 contracts, 5 worker test fajlova, 20 fajlova pod `apps/web/e2e` i 9 quality registry JSON fajlova (`find … | wc -l`, 2026-11-27). To su inventarne veličine, ne testni rezultati. `git status` je bio čist prije dodavanja G0 artefakata; `HEAD` je bio `e7a37910a9c0a651d3d77a059592d755330b399c`.

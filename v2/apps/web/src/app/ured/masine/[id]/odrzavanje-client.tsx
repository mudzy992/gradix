"use client";

/**
 * F8 — tab „Održavanje“ na kartici mašine.
 *
 * Brojke (MTBF, MTTR, trošak/h) imaju svoju jedinicu u opisu, jer su najčešća greška u čitanju
 * upravo jedinice: MTTR je u MINUTAMA, MTBF i trošak po satu u satima i KM/h. Kad imenilac nema
 * smisla (nema radnih sati, nema kvarova), prikazuje se „—“, a ne 0 — nula bi bila tvrdnja.
 */
import { useMemo, useState } from "react";
import { Card, DataTable, DescriptionList, FormSection, Stack, Stat, StatusDot, TabPanel, Tabs, TextLink } from "@/components/ui/index";
import type { ServiceOrderRow } from "@/server/service-order-types";
import {
  MAINTENANCE_STATUS_LABEL,
  MAINTENANCE_STATUS_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  formatDuration,
  money,
} from "../../servis/servis-shared";

type PlanRow = {
  id: string;
  name: string;
  basis: string;
  interval_value: string;
  tolerance_pct: string;
  next_due_at: string | null;
  next_due_meter: string | null;
  status: string;
  current_meter: string | null;
  remaining: string | null;
  is_active: boolean;
};

type Reliability = {
  from: string;
  to: string;
  faultCount: number;
  finishedCount: number;
  mttrMinutes: number | null;
  mtbfHours: string | null;
  workHours: string;
  maintenanceCostAmount: string;
  maintenanceCostPerHourAmount: string | null;
  currencyCode: string;
};

export function MasinaOdrzavanjeClient({
  machineId,
  plans,
  orders,
  reliability,
}: {
  machineId: string;
  plans: PlanRow[];
  orders: ServiceOrderRow[];
  reliability: Reliability;
}) {
  const [tab,setTab]=useState("plans");
  const columns = useMemo(
    () => [
      { key: "opened", header: "Otvoren", cell: (row: ServiceOrderRow) => row.opened_at.slice(0, 10) },
      {
        key: "status",
        header: "Stanje",
        cell: (row: ServiceOrderRow) => (
          <StatusDot tone={STATUS_TONE[row.status] ?? "muted"} label={STATUS_LABEL[row.status] ?? row.status} />
        ),
      },
      { key: "description", header: "Opis", cell: (row: ServiceOrderRow) => row.description ?? "—" },
      { key: "mechanic", header: "Mehaničar", cell: (row: ServiceOrderRow) => row.assigned_mechanic_name ?? "—" },
      { key: "downtime", header: "Zastoj", numeric: true, cell: (row: ServiceOrderRow) => formatDuration(row.downtime_minutes) },
      {
        key: "cost",
        header: "Trošak",
        numeric: true,
        cell: (row: ServiceOrderRow) =>
          row.warranty_claim ? "Garancija" : money(row.total_cost_amount, row.currency_code),
      },
      { key: "warranty", header: "Garancija do", cell: (row: ServiceOrderRow) => row.warranty_until ?? "—" },
    ],
    [],
  );

  return (
    <Stack gap="var(--space-5)">
      <Card>
        <FormSection title={`Pouzdanost ${reliability.from} — ${reliability.to}`}>
          <div className="gx-dashboard-kpis">
            <Stat label="MTTR" value={formatDuration(reliability.mttrMinutes)} hint={`Prosjek na ${reliability.finishedCount} završenih naloga`} />
            <Stat
              label="MTBF"
              value={reliability.mtbfHours === null ? "—" : `${reliability.mtbfHours} h`}
              hint={
                reliability.mtbfHours === null
                  ? "Nema radnih sati ili nema kvarova — broj ne postoji"
                  : `${reliability.workHours} h rada / ${reliability.faultCount} kvarova`
              }
            />
            <Stat
              label="Trošak održavanja / h"
              value={
                reliability.maintenanceCostPerHourAmount === null
                  ? "—"
                  : money(reliability.maintenanceCostPerHourAmount, reliability.currencyCode)
              }
              hint={`Ukupno ${money(reliability.maintenanceCostAmount, reliability.currencyCode)} na ${reliability.workHours} h`}
            />
          </div>
          <DescriptionList
            items={[
              { term: "Broj kvarova", value: String(reliability.faultCount) },
              { term: "Završenih naloga", value: String(reliability.finishedCount) },
              { term: "Radni sati", value: `${reliability.workHours} h` },
              {
                term: "Trošak održavanja",
                value: money(reliability.maintenanceCostAmount, reliability.currencyCode),
              },
            ]}
          />
        </FormSection>
      </Card>

      <Tabs id="masina-odrzavanje" label="Održavanje mašine" active={tab} onChange={setTab} tabs={[{key:"plans",label:"Planovi održavanja"},{key:"orders",label:"Historija servisa"}]} />
      <TabPanel groupId="masina-odrzavanje" tabKey="plans" active={tab === "plans"}><Card>
        <FormSection>
          <DataTable
            caption="Planovi preventivnog održavanja"
            rows={plans}
            rowKey={(row) => row.id}
            emptyText="Mašina nema plan preventivnog održavanja."
            columns={[
              { key: "name", header: "Plan", cell: (row) => row.name },
              {
                key: "status",
                header: "Stanje",
                cell: (row) => (
                  <StatusDot
                    tone={MAINTENANCE_STATUS_TONE[row.status] ?? "muted"}
                    label={MAINTENANCE_STATUS_LABEL[row.status] ?? row.status}
                  />
                ),
              },
              {
                key: "due",
                header: "Sljedeći rok",
                cell: (row) => row.next_due_at ?? (row.next_due_meter ? `${row.next_due_meter} h` : "—"),
              },
              { key: "meter", header: "Brojilo", numeric: true, cell: (row) => row.current_meter ?? "—" },
              { key: "remaining", header: "Ostalo", numeric: true, cell: (row) => row.remaining ?? "—" },
            ]}
          />
          <TextLink href="/ured/servis/planovi">Otvori planove servisa</TextLink>
        </FormSection>
      </Card></TabPanel>

      <TabPanel groupId="masina-odrzavanje" tabKey="orders" active={tab === "orders"}><Card>
        <FormSection>
          <DataTable
            caption="Servisni nalozi mašine"
            columns={columns}
            rows={orders}
            rowKey={(row) => row.id}
            emptyText="Nema servisnih naloga za ovu mašinu."
          />
          <TextLink href={`/ured/servis?machine=${machineId}`}>Otvori u radionici</TextLink>
        </FormSection>
      </Card></TabPanel>
    </Stack>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { DashboardActionsResponse, DataHealthResponse } from "@gradix/contracts";
import { apiCall } from "@/api-client";
import { Card, Chip, Stat } from "@/components/ui/index";

type Dashboard = typeof DashboardActionsResponse._output;
type Health = typeof DataHealthResponse._output;
type Load<T> = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: T };

const actionLabels: Record<string, string> = {
  risky_projects: "Rizični projekti", prohibitions: "Aktivne HSE zabrane", expired_obligations: "Istekli rokovi",
  purchases_for_approval: "Nabavke za odobrenje", expiring_guarantees: "Garancije koje ističu",
  subcontractor_statements: "Situacije podizvođača za odobrenje", overdue_tasks: "Zadaci koji kasne",
  unconfirmed_days: "Dani bez potvrde", tender_deadlines: "Tenderski rokovi u 14 dana",
  open_tasks: "Otvoreni zadaci", open_machine_faults: "Otvoreni kvarovi mašina", unsigned_diaries: "Dnevnici bez potpisa",
  overdue_hse_actions: "HSE mjere koje kasne", payroll_periods: "Periodi obračuna", costs_for_approval: "Troškovi za odobrenje",
  disputed_invoices: "Računi u neslaganju", pending_costs: "Troškovi bez cijene", workers_without_rate: "Radnici bez satnice",
  my_orders: "Moji servisni nalozi", waiting_parts: "Nalozi koji čekaju dijelove", preventive_due: "Preventivni servisi",
};
const roleLabels: Record<Dashboard["items"][number]["role"], string> = {
  OWNER: "Vlasnik / administrator", PROJECT_MANAGER: "Voditelj projekta", SITE_SUPERVISOR: "Rukovodilac gradilišta",
  ACCOUNTANT: "Računovodstvo", MECHANIC: "Mehaničar",
};
const healthLabels: Record<Health["items"][number]["key"], string> = {
  unconfirmed_days: "Dani bez potvrde", projects_without_budget: "Projekti bez budžeta",
  machines_without_rate: "Mašine bez stope", workers_without_rate: "Radnici bez satnice",
  warehouses_without_minimum: "Skladišta bez minimuma", incidents_without_actions: "Incidenti bez mjera",
};

/** API permissions remain authoritative; do not display a misleading zero on request failure. */
export function RoleDashboard({ canViewActions, canViewHealth, leftTop, leftBottom, rightBottom, showKpis = false }: {
  canViewActions: boolean; canViewHealth: boolean; leftTop?: ReactNode; leftBottom?: ReactNode; rightBottom?: ReactNode; showKpis?: boolean;
}) {
  const [dashboard, setDashboard] = useState<Load<Dashboard>>({kind:"loading"});
  const [health, setHealth] = useState<Load<Health>>({kind:"loading"});
  useEffect(() => {
    let alive=true;
    if (canViewActions) void apiCall<Dashboard>("/api/dashboard").then(result => {
      if (alive) setDashboard(result.ok ? {kind:"ready",data:result.data} : {kind:"error"});
    });
    if (canViewHealth) void apiCall<Health>("/api/data-health").then(result => {
      if (alive) setHealth(result.ok ? {kind:"ready",data:result.data} : {kind:"error"});
    });
    return () => { alive=false; };
  }, [canViewActions,canViewHealth]);

  return <>
    {showKpis && canViewActions && dashboard.kind === "ready" && dashboard.data.items.length ? <div className="gx-dashboard-kpis" aria-label="Sažetak po ulozi">
      {dashboard.data.items.slice(0, 4).map(item => <Stat key={`${item.role}:${item.key}`} label={actionLabels[item.key] ?? item.key} value={String(item.count)} hint={roleLabels[item.role]} />)}
    </div> : null}
    <div className={canViewHealth || rightBottom ? "gx-cols" : "gx-dashboard-column"}>
    <div className="gx-dashboard-column">
    {leftTop}
    {canViewActions ? <Card>
      <h2 className="gx-section-title">Akcije za vas</h2>
      {dashboard.kind === "loading" ? <p role="status">Učitavanje akcija…</p> : null}
      {dashboard.kind === "error" ? <p role="alert">Akcije trenutno nisu dostupne. Osvježite stranicu i pokušajte ponovo.</p> : null}
      {dashboard.kind === "ready" ? <>
        {dashboard.data.items.filter(item=>item.count > 0).length === 0 ?
          <p>Sve pod kontrolom · zadnja provjera {new Date(dashboard.data.checkedAt).toLocaleString("bs-BA")}</p> :
          <ul className="gx-stack gx-stack--2">{dashboard.data.items.filter(item=>item.count > 0).map(item =>
            <li key={`${item.role}:${item.key}`}><Link href={item.href}>
              <strong>{actionLabels[item.key] ?? item.key}</strong> · {item.count} <span className="gx-page-sub">{roleLabels[item.role]}</span>
            </Link></li>)}</ul>}
        {dashboard.data.projectFinancials.length ? <section aria-label="Moji projekti">
          <h3>Moji projekti</h3><ul className="gx-stack gx-stack--2">{dashboard.data.projectFinancials.map(project =>
            <li key={project.projectId}><Link href={project.href}>{project.code} · {project.name}</Link> — stvarno {project.actual} {project.currency}, budžet {project.budget ?? "nije unesen"}{project.progressPercent === null ? "" : `, završeno ${project.progressPercent}%`}</li>)}</ul>
        </section> : null}
        {dashboard.data.topMachines.length ? <section aria-label="Mašine po trošku">
          <h3>Mašine po trošku na sat</h3><ul className="gx-stack gx-stack--2">{dashboard.data.topMachines.map(machine =>
            <li key={machine.machineId}><Link href={machine.href}>{machine.code} · {machine.name}</Link> — {machine.rate} {machine.currency}/h</li>)}</ul>
        </section> : null}
      </> : null}
    </Card> : null}
    {leftBottom}
    </div>
    {canViewHealth || rightBottom ? <div className="gx-dashboard-column">
    {canViewHealth ? <Card>
      <h2 className="gx-section-title">Kvalitet podataka</h2>
      {health.kind === "loading" ? <p role="status">Provjera podataka…</p> : null}
      {health.kind === "error" ? <p role="alert">Provjera podataka trenutno nije dostupna.</p> : null}
      {health.kind === "ready" ? health.data.items.length ?
        <ul className="gx-stack gx-stack--2">{health.data.items.map(item =>
          <li key={item.key}><Link href={item.href}><strong>{healthLabels[item.key]}</strong> <Chip tone={item.count > 0 ? "hot" : "hollow"}>{item.count > 0 ? `${item.count} za provjeru` : "U redu"}</Chip></Link></li>)}</ul> :
        <p>Nema prijavljenih nedostataka u dostupnom opsegu.</p> : null}
    </Card> : null}
    {rightBottom}
    </div> : null}
  </div></>;
}

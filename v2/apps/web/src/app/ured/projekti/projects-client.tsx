"use client";

/**
 * Projekti — lista, forma i detalj (tim, mašine, rokovi).
 *
 * Pravila koja ekran sprovodi:
 *  - **Dodjela je odvojen čin od upravljanja projektom.** Forma projekta je za `projects.manage`,
 *    a tim se dodaje sa `projects.assign`. Čovjek može imati jedno bez drugog — tako je odlučeno.
 *  - **Blokada se vidi PRIJE upisa.** Ako radnik/mašina ima isteklu blokirajuću obavezu, ekran to
 *    kaže i traži razlog iznimke, umjesto da pusti da server odbije popunjenu formu.
 *  - **Iznimka je vidljiva.** Red sa iznimkom nosi „Iznimka: razlog" — inače bi izgledalo kao da
 *    blokade nema.
 *  - **Status je tekst + chip**, nikad samo boja.
 *  - Jedna primarna akcija po redu, ostalo u meniju „⋯".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@gradix/contracts";
import { apiCall } from "@/api-client";
import {
  Alert, Button, Card, Chip, DataTable, EmptyState, FilterBar, Mono, PageHeader, SelectField as Select, Skeleton,
} from "@/components/ui/index";
import { ProjectDialog } from "./project-dialog";
export {
  PROJECT_EMPTY_FORM, STATUS_LABEL, fromProject, toProjectPayload,
  type MachineOption, type ProjectFormState, type WorkerOption,
} from "./projects-shared";
import { STATUS_LABEL } from "./projects-shared";
import { ProjectDetail } from "./project-detail";
import type { ProjectFinancialSummary } from "./projects-summary";
import { filterProjects } from "./projects-filter";


const STATUS_TONE: Record<string, "full" | "hot" | "hollow"> = {
  ACTIVE: "full",
  PAUSED: "hollow",
  FINISHED: "hollow",
  CANCELLED: "hollow",
  PLANNED: "hollow",
};





export default function ProjectsClient({
  canManage,
  canExport = false,
  canBook = canManage,
  canApproveManual = false,
  canAssign,
  canOverride,
  canSeeMoney = false,
  financials = {},
  initialOpenProjectId = null,
}: {
  canManage: boolean;
  canExport?: boolean;
  canBook?: boolean;
  canApproveManual?: boolean;
  canAssign: boolean;
  /** `projects.override`: bez njega se iznimka može samo ZATRAŽITI, ne odobriti. */
  canOverride: boolean;
  /** `projects.costs.view`: marža je novac, pa je vidi samo onaj ko smije vidjeti troškove. */
  canSeeMoney?: boolean;
  financials?: Record<string, ProjectFinancialSummary>;
  /**
   * Projekat koji se otvara odmah po učitavanju (dolazak sa `/pregled` linka „rizični projekat“).
   * Bez ovoga bi link vodio na listu i čovjek bi opet tražio red.
   */
  initialOpenProjectId?: string | null;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState<{ project: Project | null; returnTo: HTMLElement | null } | null>(null);
  const [open, setOpen] = useState<Project | null>(null);
  /*
   * Filter „rizični“ nije treći status: rizik je IMENOVAN (negativna marža, prekoračen budžet,
   * trošak bez cijene) i dolazi sa servera. Ekran ga samo prikazuje — inače bi svaki ekran imao
   * svoju definiciju rizika.
   */
  const [riskyOnly, setRiskyOnly] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const result = await apiCall<{ projects: Project[] }>("/api/projects?includeInactive=1");
    if (!result.ok) {
      setError(result.message);
      setProjects([]);
      return;
    }
    setProjects(result.data.projects);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => filterProjects(projects ?? [],statusFilter,riskyOnly,financials), [projects,statusFilter,riskyOnly,financials]);

  const openedOnce = useRef(false);
  useEffect(() => {
    if (!initialOpenProjectId || openedOnce.current || !projects) return;
    const match = projects.find((project) => project.id === initialOpenProjectId);
    if (match) {
      openedOnce.current = true;
      setOpen(match);
    }
  }, [initialOpenProjectId, projects]);

  const riskyCount = useMemo(
    () => (projects ?? []).filter((project) => financials[project.id]?.risky === true).length,
    [projects, financials],
  );

  return (
    <div>
      <PageHeader
        title="Projekti"
        subtitle="Gradilišta, tim i mašine na njima, i rokovi koji projekat drže otvorenim."
        actions={canManage ? (
          <Button
            variant="primary"
            icon="pin"
            onClick={(event) => setEditing({ project: null, returnTo: event.currentTarget })}
          >
            + Novi projekat
          </Button>
        ) : null}
      />

      {message ? (
        <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <FilterBar>
          <Select label="Stanje projekta"id="project-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">Sva stanja</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          {canSeeMoney ? (
            <Select
              label="Rizičnost"
              id="project-risk"
              value={riskyOnly ? "risky" : ""}
              onChange={(event) => setRiskyOnly(event.target.value === "risky")}
            >
              <option value="">Svi projekti</option>
              <option value="risky">Samo rizični ({riskyCount})</option>
            </Select>
          ) : null}
        </FilterBar>

        {canExport ? <p><a className="gx-link" href={`/api/projects/export?${new URLSearchParams({status:statusFilter,risky:riskyOnly ? "1" : "0"})}`}>Preuzmi CSV prikazanih projekata</a> · Sinhroni izvoz podržava do 1000 redova.</p> : null}
        {projects === null ? <Skeleton rows={4} /> : null}

        {projects !== null && visible.length === 0 ? (
          <EmptyState
            title="Nema projekata"
            description={
              projects.length === 0
                ? "Prvi projekat se otvara gore desno. Radnici i mašine se dodaju u detalju projekta."
                : "Nijedan projekat nije u tom stanju. Promijenite filter."
            }
          />
        ) : null}

        {visible.length > 0 ? (
          <DataTable
            caption="Projekti"
            rows={visible}
            rowKey={(project) => project.id}
            emptyText="Nema projekata."
            columns={[
              {
                key: "project",
                header: "Projekat",
                cell: (project) => (
                  <span>
                    <Button variant="quiet" aria-label={`Otvori projekat ${project.name}`} onClick={() => setOpen(project)}>
                      {project.name}
                    </Button>
                    <Mono>{project.code}</Mono>
                    {project.managerName ? <span className="gx-page-sub">Rukovodilac: {project.managerName}</span> : null}
                  </span>
                ),
              },
              { key: "status", header: "Stanje", cell: (project) => <Chip tone={STATUS_TONE[project.status] ?? "hollow"}>{STATUS_LABEL[project.status] ?? project.status}</Chip> },
              {
                key: "progress",
                header: "Napredak",
                cell: (project) => {
                  const summary = financials[project.id];
                  if (!summary || summary.progress_pct === null) {
                    return <span className="gx-page-sub">bez faza</span>;
                  }
                  return (
                    <span className="gx-stack gx-stack--2">
                      <span>{summary.progress_pct.toFixed(0)} %</span>
                      {summary.pending_cost_count > 0 ? (
                        <Chip tone="hollow">{summary.pending_cost_count} bez cijene</Chip>
                      ) : null}
                    </span>
                  );
                },
              },
              ...(canSeeMoney
                ? [{
                    key: "margin",
                    header: "Marža",
                    numeric: true,
                    cell: (project: Project) => {
                      const summary = financials[project.id];
                      if (!summary || summary.margin === null) {
                        return <span className="gx-page-sub">bez vrijednosti</span>;
                      }
                      return (
                        <span className="gx-stack gx-stack--2">
                          <span>{summary.margin}</span>
                          {summary.margin_pct === null ? null : (
                            <Chip tone={summary.margin_pct < 0 ? "hot" : "hollow"}>
                              {summary.margin_pct.toFixed(1)} %
                            </Chip>
                          )}
                        </span>
                      );
                    },
                  }]
                : []),
              { key: "place", header: "Lokacija", cell: (project) => project.sitePlace ?? "—" },
              { key: "team", header: "Tim", cell: (project) => `${project.workerCount} · ${project.machineCount}` },
              {
                key: "due",
                header: "Rokovi",
                cell: (project) =>
                  project.overdueObligations > 0 ? (
                    <Chip tone="hot">{project.overdueObligations} isteklo</Chip>
                  ) : project.expiringObligations > 0 ? (
                    <Chip tone="hollow">{project.expiringObligations} uskoro</Chip>
                  ) : (
                    <span className="gx-page-sub">—</span>
                  ),
              },
            ]}
            rowActionLabel={(project) => `Više radnji za ${project.name}`}
            actions={(project) => [
              { key: "open", label: "Tim i rokovi", onSelect: () => setOpen(project) },
              ...(canManage
                ? [{ key: "edit", label: "Izmijeni projekat", onSelect: (returnTo: HTMLElement | null | undefined) => setEditing({ project, returnTo: returnTo ?? null }) }]
                : []),
            ]}
          />
        ) : null}
      </Card>

      {editing ? (
        <ProjectDialog
          project={editing.project}
          returnTo={editing.returnTo}
          onClose={() => setEditing(null)}
          onSaved={async (text) => {
            setEditing(null);
            setMessage({ tone: "success", text });
            await load();
          }}
        />
      ) : null}

      {open ? (
        <ProjectDetail
          project={open}
          canManage={canManage}
          canBook={canBook}
          canApproveManual={canApproveManual}
          canAssign={canAssign}
          canOverride={canOverride}
          canSeeMoney={canSeeMoney}
          onClose={() => setOpen(null)}
          onChanged={load}
          onEdit={(project) => {
            setOpen(null);
            setEditing({ project, returnTo: null });
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ forma */

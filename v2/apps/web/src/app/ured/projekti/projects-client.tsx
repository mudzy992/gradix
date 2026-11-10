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
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AssignmentInput, Project, ProjectAssignment } from "@gradix/contracts";
import { apiCall } from "@/api-client";
import {
  Alert, Button, Card, Chip, DataTable, EmptyState, FilterBar, Mono, PageHeader, Select, Skeleton,
} from "@/components/ui/index";
import { ProjectDialog } from "./project-dialog";
import { ProjectDetail } from "./project-detail";

export const STATUS_LABEL: Record<string, string> = {
  PLANNED: "U planu",
  ACTIVE: "Aktivan",
  PAUSED: "Pauziran",
  FINISHED: "Završen",
  CANCELLED: "Otkazan",
};

const STATUS_TONE: Record<string, "full" | "hot" | "hollow"> = {
  ACTIVE: "full",
  PAUSED: "hollow",
  FINISHED: "hollow",
  CANCELLED: "hollow",
  PLANNED: "hollow",
};

export type WorkerOption = { id: string; firstName: string; lastName: string; isActive: boolean };
export type MachineOption = { id: string; code: string; name: string; isActive: boolean };

export const PROJECT_EMPTY_FORM = {
  code: "",
  name: "",
  status: "ACTIVE",
  sitePlace: "",
  siteAddress: "",
  startsOn: "",
  endsOn: "",
  managerWorkerId: "",
  note: "",
};

export type ProjectFormState = typeof PROJECT_EMPTY_FORM;

export const fromProject = (project: Project): ProjectFormState => ({
  code: project.code,
  name: project.name,
  status: project.status,
  sitePlace: project.sitePlace ?? "",
  siteAddress: project.siteAddress ?? "",
  startsOn: project.startsOn?.slice(0, 10) ?? "",
  endsOn: project.endsOn?.slice(0, 10) ?? "",
  managerWorkerId: project.managerWorkerId ?? "",
  note: project.note ?? "",
});

/** Prazno se šalje kao `null`, ne kao `""` — isto pravilo kao na ekranu radnika. */
export const toProjectPayload = (form: ProjectFormState) => ({
  code: form.code.trim(),
  name: form.name.trim(),
  status: form.status,
  sitePlace: form.sitePlace.trim() || null,
  siteAddress: form.siteAddress.trim() || null,
  startsOn: form.startsOn || null,
  endsOn: form.endsOn || null,
  managerWorkerId: form.managerWorkerId || null,
  note: form.note.trim() || null,
});

export default function ProjectsClient({
  canManage,
  canAssign,
  canOverride,
}: {
  canManage: boolean;
  canAssign: boolean;
  /** `projects.override`: bez njega se iznimka može samo ZATRAŽITI, ne odobriti. */
  canOverride: boolean;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState<{ project: Project | null; returnTo: HTMLElement | null } | null>(null);
  const [open, setOpen] = useState<Project | null>(null);

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

  const visible = useMemo(() => {
    const list = projects ?? [];
    return statusFilter ? list.filter((project) => project.status === statusFilter) : list;
  }, [projects, statusFilter]);

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
        </FilterBar>

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
          canAssign={canAssign}
          canOverride={canOverride}
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

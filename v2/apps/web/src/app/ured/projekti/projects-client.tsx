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
import { apiCall, jsonBody, patchBody } from "@/api-client";
import { formatDate } from "@/format";
import { Dialog } from "@/components/dialog";
import { Alert, Button, Card, Chip, EmptyState, Field, IconButton, Mono, Skeleton, inputClass } from "@/components/ui";

const STATUS_LABEL: Record<string, string> = {
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

type Worker = { id: string; firstName: string; lastName: string; isActive: boolean };
type Machine = { id: string; code: string; name: string; isActive: boolean };

const EMPTY_FORM = {
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

type FormState = typeof EMPTY_FORM;

const fromProject = (project: Project): FormState => ({
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
const toPayload = (form: FormState) => ({
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
      <div className="gx-page-head">
        <div className="gx-page-head__text">
          <h1 className="gx-page-title">Projekti</h1>
          <p className="gx-page-sub">
            Gradilišta, tim i mašine na njima, i rokovi koji projekat drže otvorenim.
          </p>
        </div>
        {canManage ? (
          <div className="gx-page-head__actions">
            <Button
              variant="primary"
              icon="pin"
              onClick={(event) => setEditing({ project: null, returnTo: event.currentTarget })}
            >
              + Novi projekat
            </Button>
          </div>
        ) : null}
      </div>

      {message ? (
        <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <div className="gx-filters" style={{ marginBottom: "var(--space-5)" }}>
          <Field label="Stanje projekta" htmlFor="project-status">
            <select
              id="project-status"
              className={inputClass}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">Sva stanja</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

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
          <table className="gx-table">
            <thead>
              <tr>
                <th>Projekat</th>
                <th>Stanje</th>
                <th>Lokacija</th>
                <th>Tim</th>
                <th>Rokovi</th>
                <th aria-label="Radnje" />
              </tr>
            </thead>
            <tbody>
              {visible.map((project) => (
                <tr key={project.id}>
                  <td>
                    <button
                      type="button"
                      className="gx-linkbtn"
                      onClick={() => setOpen(project)}
                      aria-label={`Otvori projekat ${project.name}`}
                    >
                      <span className="gx-who">{project.name}</span>
                    </button>
                    <Mono>{project.code}</Mono>
                    {project.managerName ? (
                      <div style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
                        Rukovodilac: {project.managerName}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <Chip tone={STATUS_TONE[project.status] ?? "hollow"}>
                      {STATUS_LABEL[project.status] ?? project.status}
                    </Chip>
                  </td>
                  <td>{project.sitePlace ?? "—"}</td>
                  <td>
                    {project.workerCount} · {project.machineCount}
                  </td>
                  <td>
                    {/* Rokovi se broje po istom pravilu kao ekran rokova; 0 se ne prikazuje kao
                        zeleno „sve je u redu", nego kao tiho „nema ničega isteklog". */}
                    {project.overdueObligations > 0 ? (
                      <Chip tone="hot">{project.overdueObligations} isteklo</Chip>
                    ) : project.expiringObligations > 0 ? (
                      <Chip tone="hollow">{project.expiringObligations} uskoro</Chip>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                      <Button variant="quiet" onClick={() => setOpen(project)}>
                        Tim i rokovi
                      </Button>
                      {canManage ? (
                        <IconButton
                          icon="more"
                          label={`Više radnji za ${project.name}`}
                          onClick={(event) => setEditing({ project, returnTo: event.currentTarget })}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

function ProjectDialog({
  project,
  returnTo,
  onClose,
  onSaved,
}: {
  project: Project | null;
  returnTo: HTMLElement | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<FormState>(project ? fromProject(project) : EMPTY_FORM);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Rukovodilac je RADNIK, ne nalog — zato lista radnika, ne korisnika.
    void apiCall<{ workers: Worker[] }>("/api/workers").then((result) => {
      if (result.ok) setWorkers(result.data.workers.filter((worker) => worker.isActive));
    });
  }, []);

  const set = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = project
      ? await apiCall<{ project: Project }>(`/api/projects/${project.id}`, patchBody(toPayload(form)))
      : await apiCall<{ project: Project }>("/api/projects", jsonBody(toPayload(form)));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(
      project
        ? `Projekat ${result.data.project.code} je izmijenjen.`
        : `Projekat ${result.data.project.code} je otvoren.`,
    );
  }

  return (
    <Dialog
      title={project ? `Izmjena: ${project.code}` : "Novi projekat"}
      hint="Šifra je ono što se izgovara na terenu — zato je kratka i jedinstvena u firmi."
      returnFocusTo={returnTo}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-5)" }}>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Šifra" htmlFor="project-code">
            <input
              id="project-code"
              className={inputClass}
              value={form.code}
              onChange={set("code")}
              required
              placeholder="P-24/2026"
            />
          </Field>
          <Field label="Naziv" htmlFor="project-name">
            <input
              id="project-name"
              className={inputClass}
              value={form.name}
              onChange={set("name")}
              required
              placeholder="Dionica Visoko–Kiseljak"
            />
          </Field>
        </div>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Stanje" htmlFor="project-form-status">
            <select id="project-form-status" className={inputClass} value={form.status} onChange={set("status")}>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rukovodilac" htmlFor="project-manager" hint="Radnik koji vodi projekat.">
            <select
              id="project-manager"
              className={inputClass}
              value={form.managerWorkerId}
              onChange={set("managerWorkerId")}
            >
              <option value="">— nije postavljen —</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.firstName} {worker.lastName}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Mjesto" htmlFor="project-place">
            <input
              id="project-place"
              className={inputClass}
              value={form.sitePlace}
              onChange={set("sitePlace")}
              placeholder="Visoko"
            />
          </Field>
          <Field label="Adresa gradilišta" htmlFor="project-address">
            <input
              id="project-address"
              className={inputClass}
              value={form.siteAddress}
              onChange={set("siteAddress")}
              placeholder="Branilaca BB"
            />
          </Field>
        </div>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Početak" htmlFor="project-start">
            <input id="project-start" type="date" className={inputClass} value={form.startsOn} onChange={set("startsOn")} />
          </Field>
          <Field label="Kraj" htmlFor="project-end" hint="Prazno znači da kraj još nije poznat.">
            <input id="project-end" type="date" className={inputClass} value={form.endsOn} onChange={set("endsOn")} />
          </Field>
        </div>

        <Field label="Napomena" htmlFor="project-note">
          <textarea id="project-note" className={inputClass} value={form.note} onChange={set("note")} rows={3} />
        </Field>

        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose}>
            Odustani
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Snimam…" : project ? "Sačuvaj izmjenu" : "Otvori projekat"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ detalj */

function ProjectDetail({
  project,
  canManage,
  canAssign,
  canOverride,
  onClose,
  onChanged,
  onEdit,
}: {
  project: Project;
  canManage: boolean;
  canAssign: boolean;
  canOverride: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  /** Izmjena se otvara iz detalja — inače bi čovjek morao zatvoriti detalj i tražiti red u listi. */
  onEdit: (project: Project) => void;
}) {
  const [tab, setTab] = useState<"team" | "obligations">("team");
  const [assignments, setAssignments] = useState<ProjectAssignment[] | null>(null);
  const [today, setToday] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadAssignments = useCallback(async () => {
    setError(null);
    const result = await apiCall<{ assignments: ProjectAssignment[]; today: string }>(
      `/api/projects/${project.id}/assignments`,
    );
    if (!result.ok) {
      setError(result.message);
      setAssignments([]);
      return;
    }
    setAssignments(result.data.assignments);
    setToday(result.data.today);
  }, [project.id]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  async function remove(assignment: ProjectAssignment) {
    const result = await apiCall<{ ok: true; scopeNotice: string | null }>(
      `/api/projects/${project.id}/assignments/${assignment.id}`,
      { method: "DELETE" },
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    /*
     * `scopeNotice` se prikazuje UMJESTO obične poruke, ne uz nju.
     *
     * To nije detalj: posljedica je da je osoba ostala bez ijednog projekta i da joj je opseg
     * spušten. Ako se to izgubi među „dodjela je skinuta", niko ne zna zašto radnik od sutra vidi
     * manje — a promjena dozvole bez objašnjenja je tačno ono što ne smijemo raditi.
     */
    setMessage(result.data.scopeNotice ?? "Dodjela je skinuta. Ostaje u audit tragu.");
    await loadAssignments();
    await onChanged();
  }

  return (
    <Dialog title={`${project.code} — ${project.name}`} returnFocusTo={null} onClose={onClose} wide>
      {message ? <Alert tone="success" role="status">{message}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {canManage ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="quiet" onClick={() => onEdit(project)}>
            Izmijeni projekat
          </Button>
        </div>
      ) : null}

      <div className="gx-tabs" role="tablist" aria-label="Dijelovi projekta">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "team"}
          className={`gx-tab ${tab === "team" ? "gx-tab--active" : ""}`}
          onClick={() => setTab("team")}
        >
          Tim i mašine
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "obligations"}
          className={`gx-tab ${tab === "obligations" ? "gx-tab--active" : ""}`}
          onClick={() => setTab("obligations")}
        >
          Rokovi na projektu
        </button>
      </div>

      {tab === "team" ? (
        <div>
          {canAssign ? (
            <div style={{ marginBottom: "var(--space-4)" }}>
              <Button variant="primary" onClick={() => setAdding(true)}>
                + Dodaj na projekat
              </Button>
            </div>
          ) : null}

          {assignments === null ? <Skeleton rows={3} /> : null}

          {assignments !== null && assignments.length === 0 ? (
            <EmptyState
              title="Niko nije na projektu"
              description="Dodajte radnike i mašine. Blokada zbog istekle obaveze javit će se prije upisa."
            />
          ) : null}

          {assignments !== null && assignments.length > 0 ? (
            <table className="gx-table">
              <thead>
                <tr>
                  <th>Ko / šta</th>
                  <th>Period</th>
                  <th>Napomena</th>
                  {canAssign ? <th aria-label="Radnje" /> : null}
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>
                      <div className="gx-who">
                        {assignment.workerName ??
                          `${assignment.machineCode} · ${assignment.machineName ?? ""}`}
                      </div>
                      {assignment.workerName ? <Mono>radnik</Mono> : <Mono>mašina</Mono>}
                    </td>
                    <td>
                      {formatDate(assignment.fromDate)}
                      {" – "}
                      {assignment.toDate ? formatDate(assignment.toDate) : "danas"}
                    </td>
                    <td>
                      {/* Iznimka se prikazuje uz red — inače bi izgledalo da blokade nema. */}
                      {assignment.blocked.length > 0 ? (
                        <div style={{ display: "grid", gap: 4 }}>
                          {assignment.blocked.map((blocker) =>
                            blocker.covered ? (
                              <span key={blocker.obligationId} style={{ fontSize: "var(--text-small)" }}>
                                Iznimka: {blocker.typeLabel} — {blocker.reason}
                              </span>
                            ) : (
                              <Chip key={blocker.obligationId} tone="hot">
                                {blocker.typeLabel} isteklo
                              </Chip>
                            ),
                          )}
                        </div>
                      ) : null}
                      {assignment.note ?? ""}
                    </td>
                    {canAssign ? (
                      <td>
                        <Button variant="quiet" onClick={() => void remove(assignment)}>
                          Skini
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          <p style={{ marginTop: "var(--space-4)", fontSize: "var(--text-small)", color: "var(--muted)" }}>
            {today ? `Danas je ${formatDate(today)} po vremenu firme.` : null}
          </p>

          {adding ? (
            <AssignmentDialog
              projectId={project.id}
              onClose={() => setAdding(false)}
              canOverride={canOverride}
              onSaved={async (text) => {
                setAdding(false);
                setMessage(text);
                await loadAssignments();
                await onChanged();
              }}
            />
          ) : null}
        </div>
      ) : (
        <ProjectObligations projectId={project.id} />
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ dodjela */

function AssignmentDialog({
  projectId,
  canOverride,
  onClose,
  onSaved,
}: {
  projectId: string;
  /** `projects.override` — bez njega se iznimka samo TRAŽI; odobrava je vlasnik/admin. */
  canOverride: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [kind, setKind] = useState<"worker" | "machine">("worker");
  const [entityId, setEntityId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [blockers, setBlockers] = useState<ProjectAssignment["blocked"]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiCall<{ workers: Worker[] }>("/api/workers").then((result) => {
      if (result.ok) setWorkers(result.data.workers.filter((worker) => worker.isActive));
    });
    void apiCall<{ machines: Machine[] }>("/api/equipment").then((result) => {
      if (result.ok) setMachines(result.data.machines.filter((machine) => machine.isActive));
    });
  }, []);

  /**
   * Blokade se provjeravaju PRIJE upisa — tako čovjek odmah vidi „ovo ne može" i dobije polje za
   * razlog, umjesto da popuni formu i tek onda sazna da je odbijena.
   */
  useEffect(() => {
    if (!entityId) {
      setBlockers([]);
      return;
    }
    let cancelled = false;
    void apiCall<{ project: Project }>(`/api/projects/${projectId}`).then(() => {
      if (cancelled) return;
      // Server vraća blokade uz listu dodjela; za pregled prije upisa dovoljno je pokušati dodjelu
      // sa praznim iznimkama — ali to bi je i upisalo. Zato se blokade čitaju iz obaveza entiteta.
      void loadBlockers();
    });
    async function loadBlockers() {
      const query =
        kind === "worker" ? `workerId=${entityId}` : `machineId=${entityId}`;
      const result = await apiCall<{ obligations: { id: string; typeLabel: string; state: string }[] }>(
        `/api/obligations?${query}`,
      );
      if (cancelled) return;
      if (!result.ok) return;
      const expired = result.data.obligations.filter((obligation) => obligation.state === "expired");
      setBlockers(
        expired.map((obligation) => ({
          obligationId: obligation.id,
          typeLabel: obligation.typeLabel,
          covered: false,
        })),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [entityId, kind, projectId]);

  /*
   * Bez `projects.override` polja iznimke se UOPŠTE ne prikazuju.
   *
   * Zašto ne „prikaži pa odbij na serveru": čovjek bi popunio razlog i rok, sačekao upis i dobio
   * 403 — a poruka stiže tek poslije truda. Umjesto toga nudi se jedina radnja koju smije: zahtjev.
   * Server i dalje provjerava dozvolu (UI nije odbrana), ali ovdje se ne obećava nemoguće.
   */
  const canAskOverride = blockers.length > 0 && reason.trim().length >= 10;

  async function requestOverride() {
    const blocker = blockers[0];
    if (!blocker) return;
    setBusy(true);
    setError(null);

    const result = await apiCall<{ request: { id: string } }>(
      `/api/projects/${projectId}/override-requests`,
      jsonBody({
        obligationId: blocker.obligationId,
        ...(kind === "worker" ? { workerId: entityId } : { machineId: entityId }),
        reason: reason.trim(),
        fromDate,
        toDate: toDate || null,
      }),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(
      "Zahtjev je poslan. Iznimku odobrava vlasnik ili administrator — dodjela se upisuje tek tada.",
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const body: AssignmentInput = {
      fromDate,
      toDate: toDate || null,
      note: note.trim() || null,
      ...(kind === "worker" ? { workerId: entityId } : { machineId: entityId }),
      ...(blockers.length > 0 && reason.trim().length >= 10
        ? {
            overrides: blockers.map((blocker) => ({
              obligationId: blocker.obligationId,
              reason: reason.trim(),
              validUntil: validUntil || fromDate,
            })),
          }
        : {}),
    };

    const result = await apiCall<{ assignment: ProjectAssignment }>(
      `/api/projects/${projectId}/assignments`,
      jsonBody(body),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved("Dodjela je upisana.");
  }

  return (
    <Dialog
      title="Dodjela na projekat"
      hint="Radnik ili mašina, sa periodom. Ako nešto istječe, traži se razlog iznimke."
      returnFocusTo={null}
      onClose={onClose}
    >
      <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-5)" }}>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Field label="Šta dodajete" htmlFor="assignment-kind">
          <select
            id="assignment-kind"
            className={inputClass}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as "worker" | "machine");
              setEntityId("");
              setBlockers([]);
            }}
          >
            <option value="worker">Radnika</option>
            <option value="machine">Mašinu</option>
          </select>
        </Field>

        <Field label={kind === "worker" ? "Radnik" : "Mašina"} htmlFor="assignment-entity">
          <select
            id="assignment-entity"
            className={inputClass}
            value={entityId}
            onChange={(event) => setEntityId(event.target.value)}
            required
          >
            <option value="">— izaberite —</option>
            {kind === "worker"
              ? workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.firstName} {worker.lastName}
                  </option>
                ))
              : machines.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.code} · {machine.name}
                  </option>
                ))}
          </select>
        </Field>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Od" htmlFor="assignment-from">
            <input
              id="assignment-from"
              type="date"
              className={inputClass}
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              required
            />
          </Field>
          <Field label="Do" htmlFor="assignment-to" hint="Prazno = do skidanja.">
            <input
              id="assignment-to"
              type="date"
              className={inputClass}
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Napomena" htmlFor="assignment-note">
          <input id="assignment-note" className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>

        {blockers.length > 0 ? (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <Alert tone="warning" role="alert">
              Ne može bez iznimke: {blockers.map((blocker) => blocker.typeLabel).join(", ")} — isteklo.
              {canOverride
                ? ""
                : " Iznimku odobrava vlasnik ili administrator; vi je možete zatražiti."}
            </Alert>
            <Field
              label={canOverride ? "Razlog iznimke" : "Razlog zahtjeva"}
              htmlFor="assignment-reason"
              hint={
                canOverride
                  ? "Najmanje 10 znakova. Iznimka ide u audit trag sa vašim imenom."
                  : "Najmanje 10 znakova. Zahtjev ide vlasniku ili administratoru na odobrenje."
              }
            >
              <input
                id="assignment-reason"
                className={inputClass}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={10}
              />
            </Field>
            {/* Rok iznimke postavlja ONAJ KO ODOBRAVA — tražilac ne određuje dokle pravilo važi. */}
            {canOverride ? (
              <Field label="Iznimka važi do" htmlFor="assignment-until">
                <input
                  id="assignment-until"
                  type="date"
                  className={inputClass}
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)}
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose}>
            Odustani
          </Button>
          {blockers.length > 0 && !canOverride ? (
            <Button
              variant="primary"
              onClick={() => void requestOverride()}
              disabled={busy || !entityId || !fromDate || !canAskOverride}
            >
              {busy ? "Šaljem…" : "Pošalji zahtjev"}
            </Button>
          ) : (
            <Button
              variant="primary"
              type="submit"
              disabled={busy || !entityId || !fromDate || (blockers.length > 0 && !canAskOverride)}
            >
              {busy ? "Upisujem…" : "Dodijeli"}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ rokovi */

function ProjectObligations({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<{ id: string; typeLabel: string; state: string; expiresAt: string | null }[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiCall<{ obligations: { id: string; typeLabel: string; state: string; expiresAt: string | null }[] }>(
      `/api/obligations?projectId=${projectId}`,
    ).then((result) => {
      if (!result.ok) {
        setError(result.message);
        setRows([]);
        return;
      }
      setRows(result.data.obligations);
    });
  }, [projectId]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (rows === null) return <Skeleton rows={3} />;

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nema rokova na projektu"
        description="Građevinska dozvola, saglasnosti i HSE elaborat dodaju se u Rokovima, sa projektom kao entitetom."
      />
    );
  }

  return (
    <table className="gx-table">
      <thead>
        <tr>
          <th>Obaveza</th>
          <th>Rok</th>
          <th>Stanje</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="gx-who">{row.typeLabel}</td>
            <td>{row.expiresAt ? formatDate(row.expiresAt) : "bez roka"}</td>
            <td>
              {row.state === "expired" ? (
                <Chip tone="hot">Isteklo</Chip>
              ) : row.state === "expiring" ? (
                <Chip tone="hollow">Uskoro istječe</Chip>
              ) : (
                <Chip tone="full">Važeće</Chip>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

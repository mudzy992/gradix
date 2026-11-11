"use client";

/** Detalj projekta: tim i mašine (dodjele), rokovi na projektu, poništavanje dodjele. */
import { useCallback, useEffect, useState } from "react";
import type { AssignmentInput, Project, ProjectAssignment } from "@gradix/contracts";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import { formatDate } from "@/format";
import {
  Alert, Button, Chip, DataTable, Dialog, EmptyState, Input, Mono, Select, Skeleton, Tabs, Textarea,
} from "@/components/ui/index";
import type { MachineOption, WorkerOption } from "./projects-client";

export function ProjectDetail({
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
  const [voiding, setVoiding] = useState<ProjectAssignment | null>(null);
  const [voidReason, setVoidReason] = useState("");
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

  async function change(assignment: ProjectAssignment, body: { action: "END" } | { action: "VOID"; reason: string }) {
    setError(null);
    const result = await apiCall<{ ok: true; action: "END" | "VOID"; scopeNotice: string | null }>(
      `/api/projects/${project.id}/assignments/${assignment.id}`,
      patchBody(body),
    );
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    setMessage(
      result.data.scopeNotice ??
        (body.action === "END" ? "Dodjela je završena za danas; historija ostaje." : "Dodjela je poništena uz razlog; historija ostaje."),
    );
    await loadAssignments();
    await onChanged();
    return true;
  }

  async function submitVoid(event: React.FormEvent) {
    event.preventDefault();
    if (!voiding || voidReason.trim().length < 10) return;
    const saved = await change(voiding, { action: "VOID", reason: voidReason.trim() });
    if (saved) {
      setVoiding(null);
      setVoidReason("");
    }
  }

  return (
    <Dialog title={`${project.code} — ${project.name}`} returnFocusTo={null} onClose={onClose} wide>
      {message ? <Alert tone="success" role="status">{message}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {canManage ? (
        <div className="gx-inline-flex gx-mt-2">
          <Button variant="quiet" onClick={() => onEdit(project)}>
            Izmijeni projekat
          </Button>
        </div>
      ) : null}

      <Tabs
        label="Dijelovi projekta"
        active={tab}
        onChange={(key) => setTab(key as "team" | "obligations")}
        tabs={[
          { key: "team", label: "Tim i mašine" },
          { key: "obligations", label: "Rokovi na projektu" },
        ]}
      />

      {tab === "team" ? (
        <div>
          {canAssign ? (
            <div className="gx-mt-4">
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
            <DataTable
              caption="Dodjele na projektu"
              rows={assignments}
              rowKey={(assignment) => assignment.id}
              emptyText="Niko nije na projektu."
              columns={[
                {
                  key: "who",
                  header: "Ko / šta",
                  cell: (assignment) => (
                    <span className="gx-who">
                      {assignment.workerName ?? `${assignment.machineCode} · ${assignment.machineName ?? ""}`}
                      <Mono>{assignment.workerName ? "radnik" : "mašina"}</Mono>
                    </span>
                  ),
                },
                {
                  key: "period",
                  header: "Period",
                  cell: (assignment) => (
                    <span className="gx-stack gx-stack--2">
                      {formatDate(assignment.fromDate)} – {assignment.toDate ? formatDate(assignment.toDate) : "bez kraja"}
                      {assignment.voidedAt ? (
                        <>
                          <Chip tone="hot">Poništena · {formatDate(assignment.voidedAt)}</Chip>
                          {assignment.voidedByName ? <span>Poništio/la: {assignment.voidedByName}</span> : null}
                          {assignment.voidReason ? <span>{assignment.voidReason}</span> : null}
                        </>
                      ) : assignment.toDate && assignment.toDate < today ? (
                        <Chip tone="hollow">Završena</Chip>
                      ) : assignment.toDate === today ? (
                        <Chip tone="hollow">Završava danas</Chip>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "note",
                  header: "Napomena",
                  cell: (assignment) => (
                    <span className="gx-stack gx-stack--2">
                      {assignment.blocked.map((blocker) =>
                        blocker.covered ? (
                          <span key={blocker.obligationId}>Iznimka: {blocker.typeLabel} — {blocker.reason}</span>
                        ) : (
                          <Chip key={blocker.obligationId} tone="hot">{blocker.typeLabel} isteklo</Chip>
                        ),
                      )}
                      {assignment.note ?? ""}
                    </span>
                  ),
                },
              ]}
              rowActionLabel={(assignment) => `Više radnji za ${assignment.workerName ?? assignment.machineCode ?? "dodjelu"}`}
              actions={(assignment) =>
                canAssign
                  ? [
                      ...(!assignment.voidedAt && !assignment.toDate && assignment.fromDate <= today
                        ? [{ key: "end", label: "Završi danas", onSelect: () => void change(assignment, { action: "END" }) }]
                        : []),
                      ...(!assignment.voidedAt
                        ? [{ key: "void", label: "Pogrešna dodjela", danger: true, onSelect: () => { setError(null); setVoiding(assignment); setVoidReason(""); } }]
                        : []),
                    ]
                  : []
              }
            />
          ) : null}

          <p className="gx-page-sub gx-mt-4">
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

          {voiding ? (
            <Dialog
              title="Poništavanje pogrešne dodjele"
              hint={`${voiding.workerName ?? voiding.machineCode ?? "Dodjela"} ostaje sačuvana u historiji. Poništiti je možete samo ako u tom periodu nije bilo evidentiranog rada.`}
              returnFocusTo={null}
              onClose={() => {
                setVoiding(null);
                setVoidReason("");
              }}
            >
              <form onSubmit={submitVoid} className="gx-stack">
                <Textarea label="Razlog poništavanja" hint="Najmanje 10, najviše 500 znakova. Ovaj razlog se ne može mijenjati."id="assignment-void-reason"
                    rows={4}
                    minLength={10}
                    maxLength={500}
                    required
                    value={voidReason}
                    onChange={(event) => setVoidReason(event.target.value)} />
                <div className="gx-inline-flex gx-mt-2">
                  <Button variant="quiet" onClick={() => setVoiding(null)}>Otkaži</Button>
                  <Button type="submit" variant="primary" disabled={voidReason.trim().length < 10}>
                    Poništi uz razlog
                  </Button>
                </div>
              </form>
            </Dialog>
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
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiCall<{ workers: WorkerOption[] }>("/api/workers").then((result) => {
      if (result.ok) setWorkers(result.data.workers.filter((worker) => worker.isActive));
    });
    void apiCall<{ machines: MachineOption[] }>("/api/equipment").then((result) => {
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
      <form onSubmit={submit} className="gx-stack">
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Select label="Šta dodajete"id="assignment-kind"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as "worker" | "machine");
              setEntityId("");
              setBlockers([]);
            }}
          >
            <option value="worker">Radnika</option>
            <option value="machine">Mašinu</option>
          </Select>

        <Select label={kind === "worker" ? "Radnik" : "Mašina"}id="assignment-entity"
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
          </Select>

        <div className="gx-cols">
          <Input label="Od"id="assignment-from"
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)} />
          <Input label="Do" hint="Prazno = bez planiranog kraja."id="assignment-to"
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)} />
        </div>

        <Input label="Napomena" id="assignment-note" value={note} onChange={(event) => setNote(event.target.value)} />

        {blockers.length > 0 ? (
          <div className="gx-stack">
            <Alert tone="warning" role="alert">
              Ne može bez iznimke: {blockers.map((blocker) => blocker.typeLabel).join(", ")} — isteklo.
              {canOverride
                ? ""
                : " Iznimku odobrava vlasnik ili administrator; vi je možete zatražiti."}
            </Alert>
            <Input label={canOverride ? "Razlog iznimke" : "Razlog zahtjeva"} hint={
                canOverride
                  ? "Najmanje 10 znakova. Iznimka ide u audit trag sa vašim imenom."
                  : "Najmanje 10 znakova. Zahtjev ide vlasniku ili administratoru na odobrenje."
              }id="assignment-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)} />
            {/* Rok iznimke postavlja ONAJ KO ODOBRAVA — tražilac ne određuje dokle pravilo važi. */}
            {canOverride ? (
              <Input label="Iznimka važi do"id="assignment-until"
                  type="date"
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)} />
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
    <DataTable
      caption="Rokovi na projektu"
      rows={rows}
      rowKey={(row) => row.id}
      emptyText="Nema rokova."
      columns={[
        { key: "type", header: "Obaveza", cell: (row) => <span className="gx-who">{row.typeLabel}</span> },
        { key: "expires", header: "Rok", cell: (row) => (row.expiresAt ? formatDate(row.expiresAt) : "bez roka") },
        {
          key: "state",
          header: "Stanje",
          cell: (row) =>
            row.state === "expired" ? (
              <Chip tone="hot">Isteklo</Chip>
            ) : row.state === "expiring" ? (
              <Chip tone="hollow">Uskoro istječe</Chip>
            ) : (
              <Chip tone="full">Važeće</Chip>
            ),
        },
      ]}
    />
  );
}

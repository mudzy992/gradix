"use client";

/** Detalj projekta: tim i mašine (dodjele), rokovi na projektu, poništavanje dodjele. */
import { useCallback, useEffect, useState } from "react";
import type { Project, ProjectAssignment } from "@gradix/contracts";
import { apiCall, patchBody } from "@/api-client";
import { formatDate } from "@/format";
import {
  Alert, Button, Chip, DataTable, Dialog, EmptyState, Mono, Skeleton, Tabs, Textarea,
} from "@/components/ui/index";
import { AssignmentDialog } from "./assignment-dialog";
import { ProjectObligations } from "./project-obligations";

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


"use client";

/** Forma projekta (Dialog, footer akcije). */
import { useEffect, useState } from "react";
import type { Project } from "@gradix/contracts";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import { Alert, Button, Dialog, Input, Select, Textarea } from "@/components/ui/index";
import {
  PROJECT_EMPTY_FORM, STATUS_LABEL, fromProject, toProjectPayload,
  type ProjectFormState, type WorkerOption,
} from "./projects-client";

export function ProjectDialog({
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
  const [form, setForm] = useState<ProjectFormState>(project ? fromProject(project) : PROJECT_EMPTY_FORM);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Rukovodilac je RADNIK, ne nalog — zato lista radnika, ne korisnika.
    void apiCall<{ workers: WorkerOption[] }>("/api/workers").then((result) => {
      if (result.ok) setWorkers(result.data.workers.filter((worker) => worker.isActive));
    });
  }, []);

  const set = (key: keyof ProjectFormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = project
      ? await apiCall<{ project: Project }>(`/api/projects/${project.id}`, patchBody(toProjectPayload(form)))
      : await apiCall<{ project: Project }>("/api/projects", jsonBody(toProjectPayload(form)));
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
      <form onSubmit={submit} className="gx-stack">
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="gx-cols">
          <Input label="Šifra"id="project-code"
              value={form.code}
              onChange={set("code")}
              required
              placeholder="P-24/2026" />
          <Input label="Naziv"id="project-name"
              value={form.name}
              onChange={set("name")}
              required
              placeholder="Dionica Visoko–Kiseljak" />
        </div>

        <div className="gx-cols">
          <Select label="Stanje"id="project-form-status" value={form.status} onChange={set("status")}>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          <Select label="Rukovodilac" hint="Radnik koji vodi projekat."id="project-manager"
              value={form.managerWorkerId}
              onChange={set("managerWorkerId")}>
              <option value="">— nije postavljen —</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.firstName} {worker.lastName}
                </option>
              ))}
            </Select>
        </div>

        <div className="gx-cols">
          <Input label="Mjesto"id="project-place"
              value={form.sitePlace}
              onChange={set("sitePlace")}
              placeholder="Visoko" />
          <Input label="Adresa gradilišta"id="project-address"
              value={form.siteAddress}
              onChange={set("siteAddress")}
              placeholder="Branilaca BB" />
        </div>

        <div className="gx-cols">
          <Input label="Početak"id="project-start" type="date" value={form.startsOn} onChange={set("startsOn")} />
          <Input label="Kraj" hint="Prazno znači da kraj još nije poznat."id="project-end" type="date" value={form.endsOn} onChange={set("endsOn")} />
        </div>

        <Textarea label="Napomena"id="project-note" value={form.note} onChange={set("note")} rows={3} />

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


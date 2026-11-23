"use client";

/** Dodjela na projekat: blokada se vidi prije upisa, iznimka traži razlog. */
import { useEffect, useState } from "react";
import type { AssignmentInput, Project, ProjectAssignment } from "@gradix/contracts";
import { apiCall, jsonBody } from "@/api-client";
import { Alert, Button, Dialog, Input, Select } from "@/components/ui/index";
import type { MachineOption, WorkerOption } from "./projects-shared";

export function AssignmentDialog({
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


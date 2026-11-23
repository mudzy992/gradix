"use client";

import { useState } from "react";
import { calendarDateFromLocalDate } from "@gradix/domain";
import { apiCall, jsonBody } from "@/api-client";
import { Button, Dialog, Input, Select, Textarea } from "@/components/ui/index";

type MachineOption = { id: string; code: string; name: string };
type WorkerOption = { id: string; firstName: string; lastName: string };
type Outcome = { outcome: string; message?: string; code?: string };

export function DailyCheckCreate({
  machines,
  workers,
  busy,
  onBusy,
  onCreated,
  onError,
}: {
  machines: MachineOption[];
  workers: WorkerOption[];
  busy: boolean;
  onBusy: (value: boolean) => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = calendarDateFromLocalDate(new Date());
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [workerId, setWorkerId] = useState(workers[0]?.id ?? "");
  const [checkedAt, setCheckedAt] = useState(`${today}T07:00`);
  const [result, setResult] = useState<"PASS" | "FAIL" | "CONDITIONAL">("PASS");
  const [note, setNote] = useState("");

  const submit = async () => {
    if (!machineId) {
      onError("Mašina je obavezna.");
      return;
    }
    onBusy(true);
    setOpen(false);
    const body = {
      machineId,
      workerId: workers.length > 0 ? workerId : null,
      checkedAt: checkedAt.includes("T") ? `${checkedAt}:00+01:00` : `${checkedAt}T07:00:00+01:00`,
      result,
      checklistJson: {},
      note: note.trim() || null,
    };
    const res = await apiCall<Outcome>("/api/machine-daily-checks", jsonBody(body));
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    if (res.data.outcome !== "OK") {
      onError(res.data.message ?? res.data.code ?? "Unos nije uspio.");
      return;
    }
    onCreated();
  };

  return (
    <>
      <Button variant="primary" icon="plus" disabled={busy || machines.length === 0} onClick={() => setOpen(true)}>
        Novi unos
      </Button>
      {open ? (
        <Dialog
          title="Unos dnevnog pregleda"
          onClose={() => setOpen(false)}
          footer={(
            <div className="gx-dialog__actions">
              <Button variant="quiet" onClick={() => setOpen(false)} disabled={busy}>Odustani</Button>
              <Button variant="primary" onClick={() => void submit()} disabled={busy}>
                {busy ? "Radim…" : "Sačuvaj"}
              </Button>
            </div>
          )}
        >
          <Select label="Mašina" value={machineId} onChange={(event) => setMachineId(event.target.value)}>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>{machine.code} — {machine.name}</option>
            ))}
          </Select>
          {workers.length > 0 ? (
            <Select label="Rukovalac" value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>{worker.firstName} {worker.lastName}</option>
              ))}
            </Select>
          ) : null}
          <Input label="Vrijeme" type="datetime-local" value={checkedAt} onChange={(e) => setCheckedAt(e.target.value)} />
          <Select label="Ishod" value={result} onChange={(event) => setResult(event.target.value as typeof result)}>
            <option value="PASS">Prošao</option>
            <option value="FAIL">Nije prošao</option>
            <option value="CONDITIONAL">Uvjetno</option>
          </Select>
          <Textarea label="Napomena" value={note} onChange={(e) => setNote(e.target.value)} />
        </Dialog>
      ) : null}
    </>
  );
}

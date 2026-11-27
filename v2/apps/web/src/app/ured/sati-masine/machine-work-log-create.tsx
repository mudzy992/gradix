"use client";

import { useState } from "react";
import { calendarDateFromLocalDate } from "@gradix/domain";
import { apiCall, jsonBody } from "@/api-client";
import { Button, Dialog, Input, Select, Textarea } from "@/components/ui/index";

type MachineOption = { id: string; code: string; name: string };
type WorkerOption = { id: string; firstName: string; lastName: string };
type Outcome = { outcome: string; message?: string; code?: string };

function toIsoInstant(date: string, time: string): string {
  return `${date}T${time}:00+01:00`;
}

export function MachineWorkLogCreate({
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
  const [workDate, setWorkDate] = useState(today);
  const [started, setStarted] = useState("07:00");
  const [ended, setEnded] = useState("15:00");
  const [mode, setMode] = useState("WORK");
  const [meterEnd, setMeterEnd] = useState("");
  const [note, setNote] = useState("");

  const submit = async () => {
    if (!machineId) {
      onError("Izaberi mašinu.");
      return;
    }
    if (workers.length > 0 && !workerId) {
      onError("Izaberi radnika.");
      return;
    }
    onBusy(true);
    setOpen(false);
    const body = {
      machineId,
      workerId: workers.length > 0 ? workerId : null,
      startedAt: toIsoInstant(workDate, started),
      endedAt: toIsoInstant(workDate, ended),
      mode,
      meterEnd: meterEnd.trim() ? Number(meterEnd) : null,
      note: note.trim() || null,
    };
    const res = await apiCall<Outcome>("/api/machine-work-logs", jsonBody(body));
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
      <Button
        variant="primary"
        icon="plus"
        disabled={busy || machines.length === 0}
        onClick={() => setOpen(true)}
      >
        Novi unos
      </Button>
      {open ? (
        <Dialog
          title="Unos sati mašine"
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
            <Select label="Radnik" value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>{worker.firstName} {worker.lastName}</option>
              ))}
            </Select>
          ) : null}
          <Input label="Datum" type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} />
          <Input label="Početak" type="time" value={started} onChange={(event) => setStarted(event.target.value)} />
          <Input label="Kraj" type="time" value={ended} onChange={(event) => setEnded(event.target.value)} />
          <Select label="Režim" value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="WORK">Rad</option>
            <option value="IDLE">Mirovanje</option>
            <option value="BREAKDOWN">Kvar</option>
          </Select>
          <Input
            label="Brojilo (opcionalno)"
            inputMode="decimal"
            value={meterEnd}
            onChange={(event) => setMeterEnd(event.target.value)}
          />
          <Textarea label="Napomena" value={note} onChange={(event) => setNote(event.target.value)} />
        </Dialog>
      ) : null}
    </>
  );
}
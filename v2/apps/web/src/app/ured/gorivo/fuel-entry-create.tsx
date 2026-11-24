"use client";

import { useState } from "react";
import { calendarDateFromLocalDate } from "@gradix/domain";
import { apiCall, jsonBody } from "@/api-client";
import { Button, Dialog, Input, Select, Textarea } from "@/components/ui/index";

type MachineOption = { id: string; code: string; name: string };
type WorkerOption = { id: string; firstName: string; lastName: string };
type Outcome = { outcome: string; message?: string; code?: string };

export function FuelEntryCreate({
  machines,
  workers,
  tanks = [],
  showPrice,
  busy,
  onBusy,
  onCreated,
  onError,
}: {
  machines: MachineOption[];
  workers: WorkerOption[];
  /** F4: cisterne, samo kad je cisterna uključena PO FIRMI. */
  tanks?: { id: string; name: string; current_l: number }[];
  showPrice: boolean;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = calendarDateFromLocalDate(new Date());
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [workerId, setWorkerId] = useState(workers[0]?.id ?? "");
  const [filledAt, setFilledAt] = useState(`${today}T12:00`);
  const [liters, setLiters] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [meterReading, setMeterReading] = useState("");
  const [note, setNote] = useState("");
  const [tankId, setTankId] = useState("");

  const submit = async () => {
    if (!machineId || !liters.trim()) {
      onError("Mašina i litre su obavezni.");
      return;
    }
    /*
     * F4: iznos VIŠE NIJE obavezan. Kad ga nema, servis predlaže cijenu iz šifarnika po datumu;
     * ako ni šifarnik nema cijenu, iznos ostaje `NULL` (D1) — nikad nula. Zato se ovdje ne
     * traži iznos, nego se samo provjerava oblik kad je upisan.
     */
    if (showPrice && totalAmount.trim() && !/^\d+(\.\d{1,2})?$/.test(totalAmount.trim())) {
      onError("Iznos je decimalni broj (npr. 120.50) ili prazan.");
      return;
    }
    onBusy(true);
    const body = {
      machineId,
      driverWorkerId: workers.length > 0 ? workerId : null,
      filledAt: filledAt.includes("T") ? `${filledAt}:00+01:00` : `${filledAt}T12:00:00+01:00`,
      liters: Number(liters),
      ...(showPrice && totalAmount.trim() ? { totalAmount: totalAmount.trim() } : {}),
      meterReading: meterReading.trim() ? Number(meterReading) : null,
      note: note.trim() || null,
      tankId: tankId || null,
    };
    const res = await apiCall<Outcome>("/api/fuel-entries", jsonBody(body));
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    if (res.data.outcome !== "OK") {
      onError(res.data.message ?? res.data.code ?? "Unos nije uspio.");
      return;
    }
    setOpen(false);
    onCreated();
  };

  return (
    <>
      <Button variant="primary" icon="plus" disabled={busy || machines.length === 0} onClick={() => setOpen(true)}>
        Novi unos
      </Button>
      {open ? (
        <Dialog
          title="Unos goriva"
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
            <Select label="Vozač" value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>{worker.firstName} {worker.lastName}</option>
              ))}
            </Select>
          ) : null}
          <Input label="Datum i vrijeme" type="datetime-local" value={filledAt} onChange={(e) => setFilledAt(e.target.value)} />
          <Input label="Litara" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} />
          {tanks.length > 0 ? (
            <Select label="Cisterna" value={tankId} onChange={(event) => setTankId(event.target.value)}>
              <option value="">Pumpa (bez cisterne)</option>
              {tanks.map((tank) => (
                <option key={tank.id} value={tank.id}>
                  {tank.name} — {tank.current_l.toFixed(0)} l
                </option>
              ))}
            </Select>
          ) : null}
          {showPrice ? (
            <Input
              label="Ukupan iznos (opciono)"
              inputMode="decimal"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              hint="Ako je prazno, cijena se predlaže iz šifarnika po datumu. Nepoznat iznos ostaje prazan, ne nula."
            />
          ) : null}
          <Input label="Brojilo (opcionalno)" inputMode="decimal" value={meterReading} onChange={(e) => setMeterReading(e.target.value)} />
          <Textarea label="Napomena" value={note} onChange={(e) => setNote(e.target.value)} />
        </Dialog>
      ) : null}
    </>
  );
}
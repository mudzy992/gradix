"use client";

import { useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { Button, Dialog, Input, Select, Textarea } from "@/components/ui/index";

type MachineOption = { id: string; code: string; name: string };
type WorkerOption = { id: string; firstName: string; lastName: string };
type Outcome = { outcome: string; message?: string; code?: string };

export function HaulCreate({
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
  const today = new Date().toISOString().slice(0, 10);
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [workerId, setWorkerId] = useState(workers[0]?.id ?? "");
  const [hauledAt, setHauledAt] = useState(`${today}T12:00`);
  const [originText, setOriginText] = useState("");
  const [destinationText, setDestinationText] = useState("");
  const [materialText, setMaterialText] = useState("");
  const [quantity, setQuantity] = useState("");
  const [quantityUnit, setQuantityUnit] = useState<"M3" | "T">("M3");
  const [scaleTicketText, setScaleTicketText] = useState("");
  const [tripCount, setTripCount] = useState("1");
  const [note, setNote] = useState("");

  const submit = async () => {
    if (!machineId || !originText.trim() || !destinationText.trim() || !materialText.trim() || !quantity.trim()) {
      onError("Mašina, ruta, materijal i količina su obavezni.");
      return;
    }
    onBusy(true);
    setOpen(false);
    const body = {
      machineId,
      driverWorkerId: workers.length > 0 ? workerId : null,
      hauledAt: hauledAt.includes("T") ? `${hauledAt}:00+01:00` : `${hauledAt}T12:00:00+01:00`,
      originText: originText.trim(),
      destinationText: destinationText.trim(),
      materialText: materialText.trim(),
      quantity: Number(quantity),
      quantityUnit,
      scaleTicketText: scaleTicketText.trim() || null,
      tripCount: Number(tripCount) || 1,
      note: note.trim() || null,
    };
    const res = await apiCall<Outcome>("/api/hauls", jsonBody(body));
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
          title="Unos ture"
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
          <Input label="Datum i vrijeme" type="datetime-local" value={hauledAt} onChange={(e) => setHauledAt(e.target.value)} />
          <Input label="Polazište" value={originText} onChange={(e) => setOriginText(e.target.value)} />
          <Input label="Odredište" value={destinationText} onChange={(e) => setDestinationText(e.target.value)} />
          <Input label="Materijal" value={materialText} onChange={(e) => setMaterialText(e.target.value)} />
          <Input label="Količina" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <Select label="Jedinica" value={quantityUnit} onChange={(e) => setQuantityUnit(e.target.value as "M3" | "T")}>
            <option value="M3">m³</option>
            <option value="T">t</option>
          </Select>
          <Input label="Broj tura" inputMode="numeric" value={tripCount} onChange={(e) => setTripCount(e.target.value)} />
          <Input label="Vaga (opcionalno)" value={scaleTicketText} onChange={(e) => setScaleTicketText(e.target.value)} />
          <Textarea label="Napomena" value={note} onChange={(e) => setNote(e.target.value)} />
        </Dialog>
      ) : null}
    </>
  );
}

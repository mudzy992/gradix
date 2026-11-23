"use client";

import { useState } from "react";
import { calendarDateFromLocalDate } from "@gradix/domain";
import { apiCall, jsonBody } from "@/api-client";
import { Button, Dialog, Input, Select, Textarea } from "@/components/ui/index";

type MachineOption = { id: string; code: string; name: string };
type PartnerOption = { id: string; code: string; name: string };
type Outcome = { outcome: string; message?: string; code?: string };

export function FaultCreate({
  machines,
  partners,
  busy,
  onBusy,
  onCreated,
  onError,
}: {
  machines: MachineOption[];
  partners: PartnerOption[];
  busy: boolean;
  onBusy: (value: boolean) => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = calendarDateFromLocalDate(new Date());
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [partnerId, setPartnerId] = useState("");
  const [reportedAt, setReportedAt] = useState(`${today}T08:00`);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("MEDIUM");
  const [cost, setCost] = useState("");
  const [description, setDescription] = useState("");

  const submit = async () => {
    if (!machineId || !title.trim()) {
      onError("Mašina i naslov su obavezni.");
      return;
    }
    onBusy(true);
    setOpen(false);
    const amount = cost.trim() || null;
    const body = {
      machineId,
      partnerId: partnerId || null,
      reportedAt: reportedAt.includes("T") ? `${reportedAt}:00+01:00` : `${reportedAt}T08:00:00+01:00`,
      title: title.trim(),
      description: description.trim() || null,
      priority,
      estimatedCostAmount: amount,
      currencyCode: amount ? "BAM" : null,
    };
    const res = await apiCall<Outcome>("/api/machine-faults", jsonBody(body));
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
          title="Prijava kvara"
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
          <Select label="Partner (opciono)" value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
            <option value="">Bez partnera</option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>{partner.code} — {partner.name}</option>
            ))}
          </Select>
          <Input label="Vrijeme" type="datetime-local" value={reportedAt} onChange={(e) => setReportedAt(e.target.value)} />
          <Input label="Naslov" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select label="Prioritet" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            <option value="LOW">Nizak</option>
            <option value="MEDIUM">Srednji</option>
            <option value="HIGH">Visok</option>
            <option value="CRITICAL">Kritičan</option>
          </Select>
          <Input label="Procijenjeni trošak" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="npr. 500.00" />
          <Textarea label="Opis" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Dialog>
      ) : null}
    </>
  );
}

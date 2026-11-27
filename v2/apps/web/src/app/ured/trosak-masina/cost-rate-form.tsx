"use client";

import { useState } from "react";
import { calendarDateFromLocalDate } from "@gradix/domain";
import { apiCall, jsonBody } from "@/api-client";
import { Button, Dialog, Input, Select } from "@/components/ui/index";
import type { CostRateRow } from "@/server/machine-cost-rate-types";

type MachineOption = { id: string; code: string; name: string };
type Outcome = { outcome: string; message?: string; code?: string };

export function CostRateForm({
  machines,
  initialMachine,
  edit,
  busy,
  onBusy,
  onDone,
  onError,
  triggerLabel,
}: {
  machines: MachineOption[];
  initialMachine?: string;
  edit?: CostRateRow | null;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onDone: () => void;
  onError: (message: string) => void;
  triggerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const today = calendarDateFromLocalDate(new Date());
  const [machineId, setMachineId] = useState(edit?.machine_id ?? initialMachine ?? machines[0]?.id ?? "");
  const [amount, setAmount] = useState(edit?.amount ?? "");
  const [validFrom, setValidFrom] = useState(edit?.valid_from ?? today);
  const [validTo, setValidTo] = useState(edit?.valid_to ?? "");

  const submit = async () => {
    if (!machineId || !amount.trim() || !validFrom) {
      onError("Mašina, iznos i važi od su obavezni.");
      return;
    }
    onBusy(true);
    setOpen(false);
    const body = {
      id: edit?.id,
      machineId,
      amount: amount.trim(),
      validFrom,
      validTo: validTo.trim() || null,
    };
    const res = await apiCall<Outcome>("/api/machine-cost-rates", jsonBody(body));
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    if (res.data.outcome !== "OK") {
      onError(res.data.message ?? res.data.code ?? "Spremanje nije uspjelo.");
      return;
    }
    onDone();
  };

  return (
    <>
      <Button
        variant={edit ? "secondary" : "primary"}
        icon={edit ? undefined : "plus"}
        disabled={busy || machines.length === 0}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>
      {open ? (
        <Dialog
          title={edit ? "Izmjena stope" : "Nova stopa"}
          onClose={() => setOpen(false)}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>Otkaži</Button>
              <Button variant="primary" onClick={() => void submit()}>Sačuvaj</Button>
            </>
          )}
        >
          <Select
            label="Mašina"
            value={machineId}
            disabled={Boolean(edit)}
            onChange={(event) => setMachineId(event.target.value)}
          >
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.code} — {machine.name}
              </option>
            ))}
          </Select>
          <Input
            label="Iznos po satu (npr. 85.00)"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
          />
          <Input
            label="Važi od"
            type="date"
            value={validFrom}
            onChange={(event) => setValidFrom(event.target.value)}
          />
          <Input
            label="Važi do (opcionalno)"
            type="date"
            value={validTo}
            onChange={(event) => setValidTo(event.target.value)}
          />
        </Dialog>
      ) : null}
    </>
  );
}

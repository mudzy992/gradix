"use client";

import { useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { Button, Dialog, Input, Textarea } from "@/components/ui/index";
import type { MachineWorkLogRow } from "@/server/machine-work-log-types";

type Outcome = { outcome: string; message?: string; code?: string };

export function MachineWorkLogRevise({
  log,
  busy,
  onBusy,
  onDone,
  onError,
}: {
  log: MachineWorkLogRow;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState(log.note ?? "");
  const reasonInvalid = reason.trim().length < 10;

  const submit = async () => {
    if (reasonInvalid) return;
    onBusy(true);
    setOpen(false);
    const res = await apiCall<Outcome>(`/api/machine-work-logs/${log.id}/revise`, jsonBody({
      reason,
      payload: { note: note.trim() || null, previousMode: log.mode, meterEnd: log.meter_end },
    }));
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    if (res.data.outcome !== "OK") {
      onError(res.data.message ?? res.data.code ?? "Ispravka nije uspjela.");
      return;
    }
    onDone();
  };

  return (
    <>
      <Button disabled={busy} onClick={() => { setReason(""); setNote(log.note ?? ""); setOpen(true); }}>
        Ispravka
      </Button>
      {open ? (
        <Dialog
          title="Ispravka sati mašine"
          onClose={() => setOpen(false)}
          footer={(
            <div className="gx-dialog__actions">
              <Button variant="quiet" onClick={() => setOpen(false)} disabled={busy}>Odustani</Button>
              <Button variant="primary" onClick={() => void submit()} disabled={busy || reasonInvalid}>
                {busy ? "Radim…" : "Sačuvaj ispravku"}
              </Button>
            </div>
          )}
        >
          <p>Originalni zapis ostaje; revizija ide u audit.</p>
          <Textarea
            label="Razlog ispravke (najmanje 10 znakova)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Input
            label="Napomena u reviziji"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Dialog>
      ) : null}
    </>
  );
}
"use client";

import { useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { Button, Dialog, Textarea } from "@/components/ui/index";
import type { FuelEntryRow } from "@/server/fuel-entry-types";

type Outcome = { outcome: string; message?: string };

export function FuelEntryRevise({
  entry,
  busy,
  onBusy,
  onDone,
  onError,
}: {
  entry: FuelEntryRow;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const submit = async () => {
    onBusy(true);
    setOpen(false);
    const res = await apiCall<Outcome>(`/api/fuel-entries/${entry.id}/revise`, jsonBody({
      reason,
      payload: { note: entry.note },
    }));
    onBusy(false);
    if (!res.ok || res.data.outcome !== "OK") {
      onError(!res.ok ? res.message : res.data.message ?? "Ispravka nije uspjela.");
      return;
    }
    onDone();
  };

  return (
    <>
      <Button variant="quiet" disabled={busy} onClick={() => setOpen(true)}>Ispravi</Button>
      {open ? (
        <Dialog
          title="Ispravka točenja"
          onClose={() => setOpen(false)}
          footer={(
            <div className="gx-dialog__actions">
              <Button variant="quiet" onClick={() => setOpen(false)} disabled={busy}>Odustani</Button>
              <Button variant="primary" onClick={() => void submit()} disabled={busy || reason.trim().length < 10}>
                Sačuvaj reviziju
              </Button>
            </div>
          )}
        >
          <Textarea label="Razlog (min. 10 znakova)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Dialog>
      ) : null}
    </>
  );
}
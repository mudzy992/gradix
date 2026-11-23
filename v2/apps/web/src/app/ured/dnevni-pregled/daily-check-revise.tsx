"use client";

import { useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { Button, Dialog, Textarea } from "@/components/ui/index";
import type { DailyCheckRow } from "@/server/daily-check-types";

type Outcome = { outcome: string; message?: string };

export function DailyCheckRevise({
  check,
  busy,
  onBusy,
  onDone,
  onError,
}: {
  check: DailyCheckRow;
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
    const res = await apiCall<Outcome>(`/api/machine-daily-checks/${check.id}/revise`, jsonBody({
      reason,
      payload: { note: check.note, result: check.result },
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
          title="Ispravka dnevnog pregleda"
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

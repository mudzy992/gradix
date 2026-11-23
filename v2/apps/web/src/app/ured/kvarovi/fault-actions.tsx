"use client";

import { useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { Button, Dialog, Textarea } from "@/components/ui/index";
import type { FaultRow } from "@/server/machine-fault-types";

type Outcome = { outcome: string; message?: string; code?: string };

export function FaultActions({
  fault,
  canRevise,
  canApprove,
  busy,
  onBusy,
  onDone,
  onError,
}: {
  fault: FaultRow;
  canRevise: boolean;
  canApprove: boolean;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onDone: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reason, setReason] = useState("");

  const approve = async () => {
    onBusy(true);
    const res = await apiCall<Outcome>(`/api/machine-faults/${fault.id}/approve`, jsonBody({}));
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    if (res.data.outcome !== "OK") {
      onError(res.data.message ?? "Odobrenje nije uspjelo.");
      return;
    }
    onDone("Trošak je odobren.");
  };

  const reject = async () => {
    onBusy(true);
    const res = await apiCall<Outcome>(
      `/api/machine-faults/${fault.id}/reject`,
      jsonBody({ reason: "Odbijeno zbog previsokog troška." }),
    );
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    if (res.data.outcome !== "OK") {
      onError(res.data.message ?? "Odbijanje nije uspjelo.");
      return;
    }
    onDone("Zahtjev je odbijen.");
  };

  const revise = async () => {
    if (reason.trim().length < 10) {
      onError("Razlog ≥10 znakova.");
      return;
    }
    onBusy(true);
    setReviseOpen(false);
    const res = await apiCall<Outcome>(
      `/api/machine-faults/${fault.id}/revise`,
      jsonBody({ reason: reason.trim(), payload: {} }),
    );
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    if (res.data.outcome !== "OK") {
      onError(res.data.message ?? "Ispravka nije uspjela.");
      return;
    }
    onDone("Ispravka je zapisana.");
  };

  return (
    <div>
      {canApprove && fault.status === "WAITING_APPROVAL" ? (
        <>
          <Button variant="primary" disabled={busy} onClick={() => void approve()}>Odobri</Button>
          <Button variant="quiet" disabled={busy} onClick={() => void reject()}>Odbij</Button>
        </>
      ) : null}
      {canRevise ? (
        <Button variant="quiet" disabled={busy} onClick={() => setReviseOpen(true)}>Ispravi</Button>
      ) : null}
      {reviseOpen ? (
        <Dialog
          title="Ispravka kvara"
          onClose={() => setReviseOpen(false)}
          footer={(
            <div className="gx-dialog__actions">
              <Button variant="quiet" onClick={() => setReviseOpen(false)}>Odustani</Button>
              <Button variant="primary" onClick={() => void revise()} disabled={busy}>Sačuvaj</Button>
            </div>
          )}
        >
          <Textarea label="Razlog" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Dialog>
      ) : null}
    </div>
  );
}

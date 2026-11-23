"use client";

import { useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { Button, Dialog, Input } from "@/components/ui/index";

type Outcome = { outcome: string; message?: string; code?: string };

export function FuelEntryPrice({
  entryId,
  busy,
  onBusy,
  onDone,
  onError,
}: {
  entryId: string;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [totalAmount, setTotalAmount] = useState("");
  const submit = async () => {
    if (!totalAmount.trim()) {
      onError("Ukupan iznos je obavezan. Nepoznat iznos nije 0.00.");
      return;
    }
    onBusy(true);
    const res = await apiCall<Outcome>(`/api/fuel-entries/${entryId}/price`, jsonBody({
      totalAmount: totalAmount.trim(),
    }));
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    if (res.data.outcome !== "OK") {
      onError(res.data.message ?? res.data.code ?? "Cijena nije sačuvana.");
      return;
    }
    setTotalAmount("");
    setOpen(false);
    onDone();
  };
  return (
    <>
      <span>Nepoznato</span>
      <Button variant="quiet" disabled={busy} onClick={() => setOpen(true)}>Upiši cijenu</Button>
      {open ? (
        <Dialog
          title="Cijena goriva"
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
          <Input
            label="Ukupan iznos (BAM). 0.00 je stvarna nula."
            inputMode="decimal"
            value={totalAmount}
            onChange={(event) => setTotalAmount(event.target.value)}
          />
        </Dialog>
      ) : null}
    </>
  );
}

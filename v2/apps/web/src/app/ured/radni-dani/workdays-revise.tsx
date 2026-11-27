"use client";

/** R4b ispravka: Dialog + DescriptionList (staro/novo) + razlog ≥10 (katalog). */
import { useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { Button, DescriptionList, Dialog, Input, Textarea } from "@/components/ui/index";
import type { WorkdayReviewRow } from "@/server/workday-review";
import { approvalLabel } from "./approval-label";

type Outcome = { outcome: string; message?: string; code?: string };

export function ReviseAction({
  day,
  busy,
  onBusy,
  onDone,
  onError,
}: {
  day: WorkdayReviewRow;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const reasonInvalid = reason.trim().length < 10;

  const submit = async () => {
    if (reasonInvalid) return;
    onBusy(true);
    setOpen(false);
    const res = await apiCall<Outcome>(`/api/workdays/${day.id}/revise`, jsonBody({
      reason,
      payload: { note: note.trim() || null, previousApprovalStatus: day.approval_status },
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
      <Button
        disabled={busy}
        onClick={() => { setReason(""); setNote(""); setOpen(true); }}
      >
        Nova ispravka
      </Button>
      {open ? (
        <Dialog
          title="Nova ispravka"
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
          <p>Originalni dan ostaje nepromijenjen. Ispravka ide u audit kao nova revizija.</p>
          <DescriptionList
            items={[
              { term: "Staro stanje", value: approvalLabel(day.approval_status) },
              {
                term: "Nova napomena",
                value: (
                  <Input
                    label="Napomena ispravke"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                ),
              },
            ]}
          />
          <Textarea
            label="Razlog ispravke"
            hint="Obavezno, najmanje 10 znakova."
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Dialog>
      ) : null}
    </>
  );
}

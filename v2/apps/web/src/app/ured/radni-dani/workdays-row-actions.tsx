"use client";

import { Button, Inline } from "@/components/ui/index";
import type { WorkdayReviewRow } from "@/server/workday-review";
import { ReviseAction } from "./workdays-revise";

type Caps = { canConfirm: boolean; canRevise: boolean };

export function WorkdayRowActions({
  day,
  weekStatus,
  caps,
  busy,
  onConfirm,
  onBusy,
  onReviseDone,
  onReviseError,
}: {
  day: WorkdayReviewRow;
  weekStatus: string | undefined;
  caps: Caps;
  busy: boolean;
  onConfirm: () => void;
  onBusy: (value: boolean) => void;
  onReviseDone: () => void;
  onReviseError: (message: string) => void;
}) {
  const weekClosed = weekStatus === "LOCKED" || weekStatus === "WEEK_APPROVED";
  const canConfirmDay = caps.canConfirm
    && !weekClosed
    && day.status === "SUBMITTED"
    && day.open_entries === 0
    && day.open_conflicts === 0
    && (
      day.approval_status === "SUBMITTED"
      || (day.approval_status === "FOREMAN_CONFIRMED" && weekStatus === "WEEK_REJECTED")
    );
  const canReviseDay = caps.canRevise
    && (day.approval_status === "FOREMAN_CONFIRMED" || day.approval_status === "LOCKED");
  return (
    <Inline gap="var(--space-2)">
      {canConfirmDay ? (
        <Button disabled={busy} onClick={onConfirm}>Potvrdi dan</Button>
      ) : null}
      {canReviseDay ? (
        <ReviseAction
          day={day}
          busy={busy}
          onBusy={onBusy}
          onDone={onReviseDone}
          onError={onReviseError}
        />
      ) : null}
    </Inline>
  );
}

"use client";

/**
 * R4b: potvrda dana (šef) i sedmično odobri/odbij/zaključaj (ured/PM).
 * Server šalje samo podatke i boolean capability — bez funkcija (pravilo 12).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Chip, ConfirmDialog, DataTable, DescriptionList, EmptyState,
  FilterBar, Inline, Select, Skeleton,
} from "@/components/ui/index";
import type { WeekApprovalRow, WorkdayReviewRow } from "@/server/workday-review";
import { reviewLabel } from "./review-label";
import { approvalLabel, weekStartFromWorkDate, weekStatusLabel } from "./approval-label";

type Caps = { canConfirm: boolean; canDecide: boolean; canLock: boolean };
type Outcome = { outcome: string; status?: string; message?: string; code?: string };

export function WorkdaysClient({
  days,
  weeks,
  caps,
}: {
  days: WorkdayReviewRow[];
  weeks: WeekApprovalRow[];
  caps: Caps;
}) {
  const router = useRouter();
  const weekOptions = useMemo(() => {
    const set = new Set(days.map((day) => weekStartFromWorkDate(day.work_date)));
    return [...set].sort().reverse();
  }, [days]);
  const initialWeek = useMemo(() => {
    if (caps.canConfirm) {
      const pending = weekOptions.find((start) =>
        days.some(
          (day) =>
            weekStartFromWorkDate(day.work_date) === start
            && day.status === "SUBMITTED"
            && day.approval_status === "SUBMITTED"
            && day.open_entries === 0
            && day.open_conflicts === 0,
        ),
      );
      if (pending) return pending;
    }
    if (caps.canDecide || caps.canLock) {
      const confirmed = weekOptions.find((start) =>
        days.some(
          (day) =>
            weekStartFromWorkDate(day.work_date) === start
            && day.approval_status === "FOREMAN_CONFIRMED",
        ),
      );
      if (confirmed) return confirmed;
    }
    return weekOptions[0] ?? "";
  }, [weekOptions, days, caps.canConfirm, caps.canDecide, caps.canLock]);
  const [weekStart, setWeekStart] = useState(initialWeek);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const weekMap = useMemo(() => new Map(weeks.map((row) => [row.week_start, row])), [weeks]);
  const week = weekMap.get(weekStart);
  const visible = days.filter((day) => weekStartFromWorkDate(day.work_date) === weekStart);

  const refresh = () => { setBusy(false); router.refresh(); };

  const run = async (path: string, body?: unknown) => {
    setBusy(true);
    setNotice(null);
    const res = await apiCall<Outcome>(path, body === undefined ? { method: "POST" } : jsonBody(body));
    if (!res.ok) {
      setBusy(false);
      setNotice({ tone: "error", text: res.message });
      return;
    }
    const data = res.data;
    if (data.outcome === "OK") {
      setNotice({ tone: "success", text: data.status === "LOCKED" ? "Sedmica je zaključana." : data.status === "WEEK_APPROVED" ? "Sedmica je odobrena." : data.status === "WEEK_REJECTED" ? "Sedmica je odbijena." : "Dan je potvrđen." });
      refresh();
      return;
    }
    setBusy(false);
    setNotice({
      tone: data.outcome === "VALIDATION_FAILED" || data.outcome === "CONFLICT" ? "warning" : "error",
      text: data.message ?? data.code ?? "Akcija nije uspjela.",
    });
  };

  if (days.length === 0) {
    return <EmptyState title="Nema dana u ovoj sedmici" description="Kad stignu unosi s terena, pojaviće se ovdje." />;
  }

  return (
    <>
      {busy ? <Skeleton rows={3} /> : null}
      {notice ? <Alert tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</Alert> : null}
      {week?.status === "WEEK_REJECTED" ? (
        <DescriptionList items={[{ term: "Odbijeno", value: week.reason ?? "Bez razloga" }]} />
      ) : null}
      {week?.status === "LOCKED" ? <Chip>{weekStatusLabel("LOCKED")}</Chip> : null}
      <FilterBar>
        <Select label="Sedmica" value={weekStart} onChange={(event) => setWeekStart(event.target.value)}>
          {weekOptions.map((start) => (
            <option key={start} value={start}>{start} · {weekStatusLabel(weekMap.get(start)?.status)}</option>
          ))}
        </Select>
      </FilterBar>
      {(caps.canDecide || caps.canLock) && weekStart ? (
        <Inline gap="var(--space-2)">
          {caps.canDecide ? (
            <>
              <Button variant="primary" disabled={busy || week?.status === "LOCKED" || week?.status === "WEEK_APPROVED"} onClick={() => void run("/api/work-weeks/decide", { weekStart, decision: "APPROVE" })}>
                Odobri sedmicu
              </Button>
              <Button disabled={busy || week?.status === "LOCKED"} onClick={() => { setReason(""); setRejectOpen(true); }}>
                Odbij uz razlog
              </Button>
            </>
          ) : null}
          {caps.canLock ? (
            <Button disabled={busy || week?.status !== "WEEK_APPROVED"} onClick={() => void run("/api/work-weeks/lock", { weekStart })}>
              Zaključaj
            </Button>
          ) : null}
        </Inline>
      ) : null}
      <DataTable
        caption="Radni dani"
        rows={visible}
        rowKey={(day) => day.id}
        emptyText="Nema dana za izabranu sedmicu."
        columns={[
          {
            key: "worker",
            header: "Radnik · datum",
            cell: (day) => (
              <span><strong>{day.worker_name}</strong><br />{day.work_date}</span>
            ),
          },
          { key: "projects", header: "Projekti", cell: (day) => day.project_codes ?? "—" },
          { key: "entries", header: "Unosi", cell: (day) => day.entries },
          {
            key: "approval",
            header: "Stanje",
            cell: (day) => (
              <Chip tone={day.approval_status === "SUBMITTED" ? "hot" : undefined}>
                {approvalLabel(day.approval_status)}
              </Chip>
            ),
          },
          { key: "label", header: "Oznaka", cell: (day) => reviewLabel(day) ?? "—" },
          {
            key: "actions",
            header: "",
            cell: (day) => (
              caps.canConfirm
                && day.status === "SUBMITTED"
                && day.open_entries === 0
                && day.open_conflicts === 0
                && (
                  day.approval_status === "SUBMITTED"
                  || (day.approval_status === "FOREMAN_CONFIRMED" && week?.status === "WEEK_REJECTED")
                )
                ? (
                  <Button
                    disabled={busy}
                    onClick={() => void run(`/api/workdays/${day.id}/confirm`)}
                  >
                    Potvrdi dan
                  </Button>
                )
                : null
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={rejectOpen}
        title="Odbij sedmicu"
        text="Šef vidi razlog i može ponovo potvrditi dane. Internih napomena nema."
        confirmLabel="Odbij sedmicu"
        danger
        busy={busy}
        reason={{ value: reason, onChange: setReason, minLength: 10, label: "Razlog odbijanja", hint: "Obavezno, najmanje 10 znakova." }}
        onCancel={() => setRejectOpen(false)}
        onConfirm={() => { setRejectOpen(false); void run("/api/work-weeks/decide", { weekStart, decision: "REJECT", reason }); }}
      />
    </>
  );
}

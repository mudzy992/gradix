"use client";

/**
 * F4 (Modul 5 §1.3.13) — odstupanja potrošnje goriva.
 *
 * Pravilo koje ekran sprovodi: **upozorenje se ne zatvara tiho.** Zatvaranje traži status
 * (`EXPLAINED` ili `DISMISSED`), razlog iz zatvorene šifre i napomenu ≥10 znakova. Točenje je
 * uvijek prošlo — ovdje se zatvara samo upozorenje, ne unos.
 *
 * Zašto razlog iz šifre, a ne slobodan tekst: slobodan tekst se ne sabira. Sa šiframa se poslije
 * vidi je li problem u kvarovima, krađi ili očitanju — a to je jedino što vlasnik može koristiti.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, patchBody } from "@/api-client";
import {
  Alert, Button, DataTable, Dialog, EmptyState, Input, Select, Skeleton, Stack, StatusDot,
} from "@/components/ui/index";

type DeviationReason = "BREAKDOWN" | "THEFT" | "MISREAD" | "OTHER";

type DeviationRow = {
  id: string;
  entry_id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  filled_at: string;
  liters: number;
  consumption: number | null;
  consumption_unit: "l/h" | "l/100km" | null;
  baseline: number | null;
  deviation_pct: number | null;
  threshold_pct: number;
  status: "OPEN" | "EXPLAINED" | "DISMISSED";
  reason: DeviationReason | null;
  note: string | null;
  reviewed_at: string | null;
};

const REASON_LABELS: Record<DeviationReason, string> = {
  BREAKDOWN: "Kvar",
  THEFT: "Krađa",
  MISREAD: "Pogrešno očitanje",
  OTHER: "Ostalo",
};

const STATUS_LABELS: Record<DeviationRow["status"], string> = {
  OPEN: "Otvoreno",
  EXPLAINED: "Objašnjeno",
  DISMISSED: "Odbačeno",
};

export function DeviationsPanel({ showPrice }: { showPrice: boolean }) {
  const [rows, setRows] = useState<DeviationRow[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [explainFor, setExplainFor] = useState<DeviationRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiCall<{ deviations: DeviationRow[]; open_count: number }>(
      "/api/fuel-entries/deviations",
    );
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setRows(res.data.deviations);
    setOpenCount(res.data.open_count);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <Alert tone="error" role="alert">{error}</Alert>;
  if (!rows) return <Skeleton rows={3} />;

  return (
    <Stack gap="var(--space-4)">
      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}
      {openCount > 0 ? (
        <Alert tone="warning" role="status">
          {openCount} {openCount === 1 ? "upozorenje čeka" : "upozorenja čekaju"} objašnjenje.
          Točenje nije blokirano — zatvara se samo upozorenje.
        </Alert>
      ) : null}
      <DataTable
        caption="Odstupanja potrošnje"
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          { key: "machine", header: "Mašina", cell: (row) => `${row.machine_code} — ${row.machine_name}` },
          { key: "filled", header: "Točenje", cell: (row) => row.filled_at.slice(0, 16).replace("T", " ") },
          { key: "liters", header: "L", cell: (row) => row.liters.toFixed(2) },
          {
            key: "consumption",
            header: "Potrošnja",
            cell: (row) =>
              row.consumption === null
                ? "—"
                : `${row.consumption.toFixed(2)} ${row.consumption_unit ?? ""}`,
          },
          {
            key: "baseline",
            header: "Prosjek 90 dana",
            cell: (row) => (row.baseline === null ? "—" : row.baseline.toFixed(2)),
          },
          {
            key: "deviation",
            header: `Odstupanje (prag ${rows[0]?.threshold_pct ?? 20}%)`,
            cell: (row) =>
              row.deviation_pct === null ? "—" : `${row.deviation_pct > 0 ? "+" : ""}${row.deviation_pct.toFixed(0)}%`,
          },
          {
            key: "status",
            header: "Status",
            cell: (row) => (
              <StatusDot
                tone={row.status === "OPEN" ? "danger" : row.status === "EXPLAINED" ? "ok" : "muted"}
                label={STATUS_LABELS[row.status]}
              />
            ),
          },
          {
            key: "actions",
            header: "",
            cell: (row) =>
              row.status === "OPEN" ? (
                <Button variant="secondary" onClick={() => setExplainFor(row)}>Objasni</Button>
              ) : (
                <span className="gx-muted">
                  {row.reason ? REASON_LABELS[row.reason] : "—"}
                  {showPrice ? "" : ""}
                </span>
              ),
          },
        ]}
        empty={(
          <EmptyState
            title="Nema odstupanja"
            description="Upozorenje se pojavljuje kad potrošnja pređe prag firme iznad prosjeka zadnjih 90 dana."
          />
        )}
      />

      {explainFor ? (
        <ExplainDialog
          row={explainFor}
          busy={busy}
          onBusy={setBusy}
          onClose={() => setExplainFor(null)}
          onDone={() => {
            setExplainFor(null);
            setNotice("Odstupanje je objašnjeno — ostaje u trag kao zapis.");
            void load();
          }}
          onError={setError}
        />
      ) : null}
    </Stack>
  );
}

function ExplainDialog({
  row, busy, onBusy, onClose, onDone, onError,
}: {
  row: DeviationRow;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState<"EXPLAINED" | "DISMISSED">("EXPLAINED");
  const [reason, setReason] = useState<DeviationReason>("OTHER");
  const [note, setNote] = useState("");

  const submit = async () => {
    // Ista poruka kao servis: korisnik ne treba da čeka odgovor da bi saznao pravilo.
    if (note.trim().length < 10) {
      onError("Objašnjenje mora imati najmanje 10 znakova.");
      return;
    }
    onBusy(true);
    const res = await apiCall<{ id: string; status: string }>(
      `/api/fuel-entries/${row.entry_id}/explain`,
      patchBody({ status, reason, note: note.trim() }),
    );
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    onDone();
  };

  return (
    <Dialog
      title={`Odstupanje: ${row.machine_code}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Otkaži</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>Sačuvaj</Button>
        </>
      )}
    >
      <p className="gx-muted">
        Potrošnja {row.consumption?.toFixed(2) ?? "—"} {row.consumption_unit ?? ""} prema prosjeku{" "}
        {row.baseline?.toFixed(2) ?? "—"} — odstupanje{" "}
        {row.deviation_pct === null ? "—" : `${row.deviation_pct.toFixed(0)}%`}.
      </p>
      <Select label="Ishod" value={status} onChange={(event) => setStatus(event.target.value as "EXPLAINED" | "DISMISSED")}>
        <option value="EXPLAINED">Objašnjeno — odstupanje je stvarno</option>
        <option value="DISMISSED">Odbačeno — nije stvarno odstupanje</option>
      </Select>
      <Select label="Razlog" value={reason} onChange={(event) => setReason(event.target.value as DeviationReason)}>
        {(Object.keys(REASON_LABELS) as DeviationReason[]).map((key) => (
          <option key={key} value={key}>{REASON_LABELS[key]}</option>
        ))}
      </Select>
      <Input
        label="Napomena (najmanje 10 znakova)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        hint="npr. „Cisterna je punjena do vrha, brojilo nije vraćeno na nulu“"
      />
    </Dialog>
  );
}

"use client";

/**
 * F4 (Modul 5 §1.4) — stacionaže: dionice sa kilometražom i zbirom izvedenih količina.
 *
 * Zašto numerička kilometraža: zbir po dionici je ulaz u predmjer (Modul 6). Iz slobodnog teksta
 * se ne sabira, pa bi „količina po dionici" bila brojka koju niko ne može provjeriti.
 *
 * Ekran ne dozvoljava „pola" kilometraže: ili su oba kraja upisana, ili nijedan — djelimična
 * stacionaža bi tiho izostavila dionicu iz svakog zbira.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import {
  Alert, Button, DataTable, Dialog, EmptyState, Input, Skeleton, Stack,
} from "@/components/ui/index";

type Segment = {
  id: string;
  code: string;
  name: string;
  project_code: string | null;
  from_station: string | null;
  to_station: string | null;
  from_km: number | null;
  from_m: number | null;
  to_km: number | null;
  to_m: number | null;
  length_m: number | null;
  haul_count: number;
  quantity_sum: number | null;
  quantity_unit: string | null;
};

export function SegmentsPanel({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<Segment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Segment | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiCall<{ segments: Segment[] }>("/api/route-segments");
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setRows(res.data.segments);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <Alert tone="error" role="alert">{error}</Alert>;
  if (!rows) return <Skeleton rows={3} />;

  return (
    <Stack gap="var(--space-4)">
      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}
      {canManage ? (
        <div className="gx-inline-flex">
          <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Nova dionica</Button>
        </div>
      ) : null}
      <DataTable
        caption="Stacionaže"
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          { key: "code", header: "Oznaka", cell: (row) => row.code },
          { key: "name", header: "Naziv", cell: (row) => row.name },
          {
            key: "stationing",
            header: "Stacionaža",
            cell: (row) =>
              row.from_km === null
                ? "—"
                : `${row.from_km}+${String(row.from_m ?? 0).padStart(3, "0")} → ${row.to_km}+${String(row.to_m ?? 0).padStart(3, "0")}`,
          },
          {
            key: "length",
            header: "Dužina",
            cell: (row) => (row.length_m === null ? "—" : `${(row.length_m / 1000).toFixed(3)} km`),
          },
          {
            key: "quantity",
            header: "Izvedeno",
            cell: (row) =>
              row.haul_count === 0
                ? "—"
                : row.quantity_sum === null
                  ? `${row.haul_count} tura (miješane jedinice)`
                  : `${row.quantity_sum.toFixed(2)} ${row.quantity_unit ?? ""} · ${row.haul_count} tura`,
          },
          {
            key: "actions",
            header: "",
            cell: (row) => (canManage ? (
              <Button variant="quiet" onClick={() => setEditing(row)}>Izmijeni</Button>
            ) : null),
          },
        ]}
        empty={(
          <EmptyState
            title="Nema dionica"
            description="Dionica sa kilometražom daje zbir količina po relaciji — bez nje ture ostaju bez mjesta."
          />
        )}
      />
      {editing ? (
        <SegmentDialog
          segment={editing === "new" ? null : editing}
          busy={busy}
          onBusy={setBusy}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); setNotice("Dionica je sačuvana."); void load(); }}
          onError={setError}
        />
      ) : null}
    </Stack>
  );
}

function SegmentDialog({
  segment, busy, onBusy, onClose, onDone, onError,
}: {
  segment: Segment | null;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [code, setCode] = useState(segment?.code ?? "");
  const [name, setName] = useState(segment?.name ?? "");
  const [fromKm, setFromKm] = useState(segment?.from_km?.toString() ?? "");
  const [fromM, setFromM] = useState(segment?.from_m?.toString() ?? "0");
  const [toKm, setToKm] = useState(segment?.to_km?.toString() ?? "");
  const [toM, setToM] = useState(segment?.to_m?.toString() ?? "0");

  const submit = async () => {
    if (!code.trim() || !name.trim()) {
      onError("Oznaka i naziv su obavezni.");
      return;
    }
    const hasFrom = fromKm.trim().length > 0;
    const hasTo = toKm.trim().length > 0;
    if (hasFrom !== hasTo) {
      onError("Stacionaža traži oba kraja (od i do) — pola kilometraže ne ulazi u zbir.");
      return;
    }
    const body = {
      id: segment?.id,
      code: code.trim(),
      name: name.trim(),
      fromKm: hasFrom ? Number(fromKm) : null,
      fromM: hasFrom ? Number(fromM || "0") : null,
      toKm: hasTo ? Number(toKm) : null,
      toM: hasTo ? Number(toM || "0") : null,
    };
    if (body.fromKm !== null && body.toKm !== null) {
      if (body.toKm * 1000 + (body.toM ?? 0) <= body.fromKm * 1000 + (body.fromM ?? 0)) {
        onError("Kraj mora biti poslije početka — dionica ima smjer.");
        return;
      }
    }
    onBusy(true);
    const res = await apiCall<Segment>(
      "/api/route-segments",
      segment ? patchBody(body) : jsonBody(body),
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
      title={segment ? "Izmjena dionice" : "Nova dionica"}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Otkaži</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>Sačuvaj</Button>
        </>
      )}
    >
      <Input label="Oznaka" value={code} onChange={(event) => setCode(event.target.value)} hint="npr. D-1" />
      <Input label="Naziv" value={name} onChange={(event) => setName(event.target.value)} />
      <Input label="Od — km" inputMode="numeric" value={fromKm} onChange={(event) => setFromKm(event.target.value)} />
      <Input label="Od — m" inputMode="numeric" value={fromM} onChange={(event) => setFromM(event.target.value)} />
      <Input label="Do — km" inputMode="numeric" value={toKm} onChange={(event) => setToKm(event.target.value)} />
      <Input label="Do — m" inputMode="numeric" value={toM} onChange={(event) => setToM(event.target.value)} />
    </Dialog>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/api-client";
import { formatDateTime, formatNumber } from "@/format";
import {
  Alert, DataTable, EmptyState, FilterBar, Select, Skeleton, Stack,
} from "@/components/ui/index";
import type { MachineWorkLogRow } from "@/server/machine-work-log-types";
import { modeLabel } from "./mode-label";
import { MachineWorkLogCreate } from "./machine-work-log-create";
import { MachineWorkLogRevise } from "./machine-work-log-revise";

type Caps = { canCreate: boolean; canRevise: boolean };
type MachineOption = { id: string; code: string; name: string };
type WorkerOption = { id: string; firstName: string; lastName: string };

export function MachineWorkLogsClient({
  initialLogs,
  caps,
}: {
  initialLogs: MachineWorkLogRow[];
  caps: Caps;
}) {
  const router = useRouter();
  const [logs, setLogs] = useState(initialLogs);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [machineFilter, setMachineFilter] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadOptions = useCallback(async () => {
    const equipment = await apiCall<{ machines: MachineOption[] }>("/api/equipment");
    if (equipment.ok) {
      setMachines(equipment.data.machines.map((m) => ({ id: m.id, code: m.code, name: m.name })));
    }
    if (!caps.canCreate) return;
    const roster = await apiCall<{ workers: WorkerOption[] }>("/api/workers");
    if (roster.ok) {
      setWorkers(roster.data.workers.map((w) => ({
        id: w.id, firstName: w.firstName, lastName: w.lastName,
      })));
    }
  }, [caps.canCreate]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const refresh = () => {
    router.refresh();
    setLogs(initialLogs);
  };

  useEffect(() => {
    setLogs(initialLogs);
  }, [initialLogs]);

  const visible = useMemo(() => {
    if (!machineFilter) return logs;
    return logs.filter((row) => row.machine_id === machineFilter);
  }, [logs, machineFilter]);

  const columns = useMemo(() => [
    { key: "machine", header: "Mašina", cell: (row: MachineWorkLogRow) => `${row.machine_code} — ${row.machine_name}` },
    { key: "worker", header: "Rukovalac", cell: (row: MachineWorkLogRow) => row.worker_name },
    { key: "interval", header: "Interval", cell: (row: MachineWorkLogRow) =>
      `${formatDateTime(row.started_at)} — ${formatDateTime(row.ended_at)}` },
    { key: "mode", header: "Režim", cell: (row: MachineWorkLogRow) => modeLabel(row.mode) },
    { key: "meter", header: "Brojilo", cell: (row: MachineWorkLogRow) =>
      row.meter_end == null ? "—" : formatNumber(row.meter_end) },
    { key: "project", header: "Projekat", cell: (row: MachineWorkLogRow) =>
      row.project_code ? `${row.project_code} — ${row.project_name}` : "—" },
    ...(caps.canRevise ? [{
      key: "actions",
      header: "",
      cell: (row: MachineWorkLogRow) => (
        <MachineWorkLogRevise
          log={row}
          busy={busy}
          onBusy={setBusy}
          onDone={() => { setNotice({ tone: "success", text: "Ispravka je zapisana." }); refresh(); }}
          onError={(text) => setNotice({ tone: "error", text })}
        />
      ),
    }] : []),
  ], [busy, caps.canRevise]);

  return (
    <Stack gap="var(--space-5)">
      {busy ? <Skeleton rows={2} /> : null}
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}
      <FilterBar>
        <Select
          label="Mašina"
          value={machineFilter}
          onChange={(event) => setMachineFilter(event.target.value)}
        >
          <option value="">Sve mašine</option>
          {machines.map((machine) => (
            <option key={machine.id} value={machine.id}>{machine.code} — {machine.name}</option>
          ))}
        </Select>
        {caps.canCreate ? (
          <MachineWorkLogCreate
            machines={machines.filter((m) => m.id)}
            workers={workers}
            busy={busy}
            onBusy={setBusy}
            onCreated={() => { setNotice({ tone: "success", text: "Unos je sačuvan." }); refresh(); }}
            onError={(text) => setNotice({ tone: "error", text })}
          />
        ) : null}
      </FilterBar>
      <DataTable
        caption="Sati mašina"
        rows={visible}
        rowKey={(row) => row.id}
        columns={columns}
        empty={visible.length === 0 ? (
          <EmptyState
            title="Nema zapisa sati mašina"
            description="Kad stignu unosi s terena ili iz ureda, pojavit će se ovdje."
          />
        ) : undefined}
      />
    </Stack>
  );
}
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/api-client";
import { formatDateTime, formatNumber } from "@/format";
import { Alert, DataTable, EmptyState, FilterBar, Select, Skeleton, Stack } from "@/components/ui/index";
import type { FuelEntryRow } from "@/server/fuel-entry-types";
import { FuelEntryCreate } from "./fuel-entry-create";
import { FuelEntryRevise } from "./fuel-entry-revise";

type Caps = { canCreate: boolean; canRevise: boolean; showPrice: boolean };
type MachineOption = { id: string; code: string; name: string };
type WorkerOption = { id: string; firstName: string; lastName: string };

export function FuelEntriesClient({
  initialEntries,
  caps,
}: {
  initialEntries: FuelEntryRow[];
  caps: Caps;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
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

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  const refresh = () => {
    router.refresh();
    setEntries(initialEntries);
  };

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  const visible = useMemo(() => {
    if (!machineFilter) return entries;
    return entries.filter((row) => row.machine_id === machineFilter);
  }, [entries, machineFilter]);

  const columns = useMemo(() => {
    const base: Parameters<typeof DataTable<FuelEntryRow>>[0]["columns"] = [
      { key: "machine", header: "Mašina", cell: (row) => `${row.machine_code} — ${row.machine_name}` },
      { key: "driver", header: "Vozač", cell: (row) => row.driver_name },
      { key: "filled", header: "Točenje", cell: (row) => formatDateTime(row.filled_at) },
      { key: "liters", header: "L", cell: (row) => formatNumber(row.liters) },
    ];
    if (caps.showPrice) {
      base.push({
        key: "amount",
        header: "Iznos",
        cell: (row) => (row.amount ? `${row.amount} ${row.currency_code ?? ""}`.trim() : "—"),
      });
    }
    base.push(
      { key: "meter", header: "Brojilo", cell: (row) => (row.meter_reading == null ? "—" : formatNumber(row.meter_reading)) },
      { key: "project", header: "Projekat", cell: (row) => (row.project_code ? `${row.project_code} — ${row.project_name}` : "—") },
    );
    if (caps.canRevise) {
      base.push({
        key: "actions",
        header: "",
        cell: (row) => (
          <FuelEntryRevise
            entry={row}
            busy={busy}
            onBusy={setBusy}
            onDone={() => { setNotice({ tone: "success", text: "Ispravka je zapisana." }); refresh(); }}
            onError={(text) => setNotice({ tone: "error", text })}
          />
        ),
      });
    }
    return base;
  }, [busy, caps.canRevise, caps.showPrice]);

  return (
    <Stack gap="var(--space-5)">
      {busy ? <Skeleton rows={2} /> : null}
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}
      <FilterBar>
        <Select label="Mašina" value={machineFilter} onChange={(event) => setMachineFilter(event.target.value)}>
          <option value="">Sve mašine</option>
          {machines.map((machine) => (
            <option key={machine.id} value={machine.id}>{machine.code} — {machine.name}</option>
          ))}
        </Select>
        {caps.canCreate ? (
          <FuelEntryCreate
            machines={machines.filter((m) => m.id)}
            workers={workers}
            showPrice={caps.showPrice}
            busy={busy}
            onBusy={setBusy}
            onCreated={() => { setNotice({ tone: "success", text: "Unos je sačuvan." }); refresh(); }}
            onError={(text) => setNotice({ tone: "error", text })}
          />
        ) : null}
      </FilterBar>
      <DataTable
        caption="Gorivo"
        rows={visible}
        rowKey={(row) => row.id}
        columns={columns}
        empty={visible.length === 0 ? (
          <EmptyState
            title="Nema zapisa goriva"
            description="Kad stignu unosi s terena ili iz ureda, pojavit će se ovdje."
          />
        ) : undefined}
      />
    </Stack>
  );
}
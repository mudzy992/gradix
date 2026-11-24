"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/api-client";
import { formatDateTime, formatNumber } from "@/format";
import { Alert, DataTable, EmptyState, FilterBar, Select, Skeleton, Stack } from "@/components/ui/index";
import type { HaulRow } from "@/server/haul-types";
import { HaulCreate } from "./haul-create";
import { HaulRevise } from "./haul-revise";
import { SegmentsPanel } from "./segments-panel";

type Caps = {
  canCreate: boolean;
  canRevise: boolean;
  /** F4: šifarnik dionica sa stacionažom. */
  canManageSegments: boolean;
};
type MachineOption = { id: string; code: string; name: string };
type WorkerOption = { id: string; firstName: string; lastName: string };

export function HaulsClient({
  initialHauls,
  caps,
}: {
  initialHauls: HaulRow[];
  caps: Caps;
}) {
  const router = useRouter();
  const [hauls, setHauls] = useState(initialHauls);
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
    setHauls(initialHauls);
  };

  useEffect(() => {
    setHauls(initialHauls);
  }, [initialHauls]);

  const visible = useMemo(() => {
    if (!machineFilter) return hauls;
    return hauls.filter((row) => row.machine_id === machineFilter);
  }, [hauls, machineFilter]);

  const columns = useMemo(() => {
    const base: Parameters<typeof DataTable<HaulRow>>[0]["columns"] = [
      { key: "machine", header: "Mašina", cell: (row) => `${row.machine_code} — ${row.machine_name}` },
      { key: "driver", header: "Vozač", cell: (row) => row.driver_name },
      { key: "hauled", header: "Vrijeme", cell: (row) => formatDateTime(row.hauled_at) },
      { key: "route", header: "Ruta", cell: (row) => `${row.origin_text} → ${row.destination_text}` },
      { key: "material", header: "Materijal", cell: (row) => row.material_text },
      {
        key: "qty",
        header: "Količina",
        cell: (row) => `${formatNumber(row.quantity)} ${row.quantity_unit}`,
      },
      { key: "trips", header: "Ture", cell: (row) => String(row.trip_count) },
      {
        key: "scale",
        header: "Vaga",
        cell: (row) => row.scale_ticket_text ?? "—",
      },
    ];
    if (caps.canRevise) {
      base.push({
        key: "actions",
        header: "",
        cell: (row) => (
          <HaulRevise
            haul={row}
            busy={busy}
            onBusy={setBusy}
            onDone={() => { setNotice({ tone: "success", text: "Ispravka je zapisana." }); refresh(); }}
            onError={(text) => setNotice({ tone: "error", text })}
          />
        ),
      });
    }
    return base;
  }, [busy, caps.canRevise]);

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
          <HaulCreate
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
        caption="Ture"
        rows={visible}
        rowKey={(row) => row.id}
        columns={columns}
        empty={visible.length === 0 ? (
          <EmptyState
            title="Nema tura"
            description="Kad stignu unosi s terena ili iz ureda, pojavit će se ovdje."
          />
        ) : undefined}
      />
      {/*
        F4: stacionaže su šifarnik ISPOD tura. Zbir količina po dionici se računa iz tura, pa
        redoslijed na ekranu prati tok: prvo se gleda šta je prevezeno, pa po kojoj dionici.
      */}
      <SegmentsPanel canManage={caps.canManageSegments} />
    </Stack>
  );
}

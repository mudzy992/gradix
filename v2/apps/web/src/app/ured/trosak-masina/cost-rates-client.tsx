"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/api-client";
import { Alert, DataTable, EmptyState, FilterBar, Select, Skeleton, Stack } from "@/components/ui/index";
import type { CostRateRow } from "@/server/machine-cost-rate-types";
import { CostRateForm } from "./cost-rate-form";
import { CostComponentsPanel } from "./cost-components-panel";

type Caps = { canManage: boolean };
type MachineOption = { id: string; code: string; name: string };

export function CostRatesClient({
  initialRates,
  initialMachine = "",
  caps,
}: {
  initialRates: CostRateRow[];
  initialMachine?: string;
  caps: Caps;
}) {
  const router = useRouter();
  const [rates, setRates] = useState(initialRates);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [machineFilter, setMachineFilter] = useState(initialMachine);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const equipment = await apiCall<{ machines: MachineOption[] }>("/api/equipment");
    if (!equipment.ok) {
      setLoadError(equipment.message);
      setLoading(false);
      return;
    }
    setMachines(equipment.data.machines.map((m) => ({ id: m.id, code: m.code, name: m.name })));
    setLoading(false);
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => { setRates(initialRates); }, [initialRates]);

  const refresh = () => {
    router.refresh();
    setRates(initialRates);
  };

  const visible = useMemo(() => {
    if (!machineFilter) return rates;
    return rates.filter((row) => row.machine_id === machineFilter);
  }, [rates, machineFilter]);

  const columns = useMemo(() => {
    const base: Parameters<typeof DataTable<CostRateRow>>[0]["columns"] = [
      { key: "machine", header: "Mašina", cell: (row) => `${row.machine_code} — ${row.machine_name}` },
      { key: "amount", header: "Stopa / h", cell: (row) => `${row.amount} ${row.currency_code}` },
      { key: "from", header: "Važi od", cell: (row) => row.valid_from },
      { key: "to", header: "Važi do", cell: (row) => row.valid_to ?? "—" },
    ];
    if (caps.canManage) {
      base.push({
        key: "actions",
        header: "",
        cell: (row) => (
          <CostRateForm
            machines={machines}
            edit={row}
            busy={busy}
            onBusy={setBusy}
            onDone={() => { setNotice({ tone: "success", text: "Stopa je ažurirana." }); refresh(); }}
            onError={(text) => setNotice({ tone: "error", text })}
            triggerLabel="Izmijeni"
          />
        ),
      });
    }
    return base;
  }, [busy, caps.canManage, machines]);

  if (loading) {
    return <Skeleton rows={4} />;
  }
  if (loadError) {
    return <Alert tone="error" role="alert">{loadError}</Alert>;
  }

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
        {caps.canManage ? (
          <CostRateForm
            machines={machines}
            initialMachine={machineFilter || undefined}
            key={machineFilter}
            busy={busy}
            onBusy={setBusy}
            onDone={() => { setNotice({ tone: "success", text: "Stopa je sačuvana." }); refresh(); }}
            onError={(text) => setNotice({ tone: "error", text })}
            triggerLabel="Nova stopa"
          />
        ) : null}
      </FilterBar>
      {/*
        F4: komponente su sada IZVOR stope; ravna (ručna) stopa ostaje kao nadjačavanje.
        Panel se prikazuje za izabranu mašinu — bez izbora bi lista komponenti svih mašina bila
        nepregledna, a izračun se i računa po mašini.
      */}
      {machineFilter ? (
        <CostComponentsPanel
          machineId={machineFilter}
          machineLabel={
            machines.find((machine) => machine.id === machineFilter)
              ? `${machines.find((machine) => machine.id === machineFilter)!.code} — ${machines.find((machine) => machine.id === machineFilter)!.name}`
              : "Mašina"
          }
          caps={{ canManage: caps.canManage }}
          onChanged={refresh}
        />
      ) : (
        <Alert tone="info">
          Izaberite mašinu da vidite razlaganje stope po komponentama i izračunatu stopu.
        </Alert>
      )}

      <DataTable
        caption="Stope troška mašina"
        rows={visible}
        rowKey={(row) => row.id}
        columns={columns}
        empty={visible.length === 0 ? (
          <EmptyState
            title="Nema stopa"
            description="Unesite stopu po satu za mašinu da bi knjiženje na projekat radilo."
          />
        ) : undefined}
      />
    </Stack>
  );
}

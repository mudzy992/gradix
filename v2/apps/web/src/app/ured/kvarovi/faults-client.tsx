"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/api-client";
import { formatDateTime } from "@/format";
import { Alert, DataTable, EmptyState, FilterBar, Select, Skeleton, Stack } from "@/components/ui/index";
import type { FaultRow } from "@/server/machine-fault-types";
import { FaultCreate } from "./fault-create";
import { FaultActions } from "./fault-actions";

type Caps = { canCreate: boolean; canRevise: boolean; canApprove: boolean };
type MachineOption = { id: string; code: string; name: string };
type PartnerOption = { id: string; code: string; name: string };

const STATUS_LABEL: Record<FaultRow["status"], string> = {
  OPEN: "Otvoren",
  WAITING_APPROVAL: "Čeka odobrenje",
  APPROVED: "Odobren",
  IN_PROGRESS: "U toku",
  DONE: "Završen",
  CANCELLED: "Otkazan",
};

const PRIORITY_LABEL: Record<FaultRow["priority"], string> = {
  LOW: "Nizak",
  MEDIUM: "Srednji",
  HIGH: "Visok",
  CRITICAL: "Kritičan",
};

export function FaultsClient({
  initialFaults,
  caps,
}: {
  initialFaults: FaultRow[];
  caps: Caps;
}) {
  const router = useRouter();
  const [faults, setFaults] = useState(initialFaults);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [machineFilter, setMachineFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadOptions = useCallback(async () => {
    const equipment = await apiCall<{ machines: MachineOption[] }>("/api/equipment");
    if (equipment.ok) {
      setMachines(equipment.data.machines.map((m) => ({ id: m.id, code: m.code, name: m.name })));
    }
    const partnerRes = await apiCall<{ partners: PartnerOption[] }>("/api/partners");
    if (partnerRes.ok) {
      setPartners(partnerRes.data.partners.map((p) => ({ id: p.id, code: p.code, name: p.name })));
    }
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => { setFaults(initialFaults); }, [initialFaults]);

  const refresh = () => {
    router.refresh();
    setFaults(initialFaults);
  };

  const visible = useMemo(() => {
    return faults.filter((row) => {
      if (machineFilter && row.machine_id !== machineFilter) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      return true;
    });
  }, [faults, machineFilter, statusFilter]);

  const columns = useMemo(() => {
    const base: Parameters<typeof DataTable<FaultRow>>[0]["columns"] = [
      { key: "machine", header: "Mašina", cell: (row) => `${row.machine_code} — ${row.machine_name}` },
      { key: "title", header: "Naslov", cell: (row) => row.title },
      { key: "reported", header: "Prijavljeno", cell: (row) => formatDateTime(row.reported_at) },
      { key: "priority", header: "Prioritet", cell: (row) => PRIORITY_LABEL[row.priority] },
      { key: "status", header: "Status", cell: (row) => STATUS_LABEL[row.status] },
      {
        key: "cost",
        header: "Trošak",
        cell: (row) => (row.estimated_cost && row.currency_code
          ? `${row.estimated_cost} ${row.currency_code}`
          : "—"),
      },
      { key: "partner", header: "Partner", cell: (row) => row.partner_name ?? "—" },
    ];
    if (caps.canRevise || caps.canApprove) {
      base.push({
        key: "actions",
        header: "",
        cell: (row) => (
          <FaultActions
            fault={row}
            canRevise={caps.canRevise}
            canApprove={caps.canApprove}
            busy={busy}
            onBusy={setBusy}
            onDone={(text) => { setNotice({ tone: "success", text }); refresh(); }}
            onError={(text) => setNotice({ tone: "error", text })}
          />
        ),
      });
    }
    return base;
  }, [busy, caps.canApprove, caps.canRevise]);

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
        <Select label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">Svi</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        {caps.canCreate ? (
          <FaultCreate
            machines={machines}
            partners={partners}
            busy={busy}
            onBusy={setBusy}
            onCreated={() => { setNotice({ tone: "success", text: "Unos je sačuvan." }); refresh(); }}
            onError={(text) => setNotice({ tone: "error", text })}
          />
        ) : null}
      </FilterBar>
      <DataTable
        caption="Kvarovi"
        rows={visible}
        rowKey={(row) => row.id}
        columns={columns}
        empty={visible.length === 0 ? (
          <EmptyState
            title="Nema kvarova"
            description="Prijave s terena i ureda pojave se ovdje."
          />
        ) : undefined}
      />
    </Stack>
  );
}

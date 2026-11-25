"use client";

/**
 * F8 — šabloni i planovi održavanja.
 *
 * Ekran prikazuje ŠABLONE (šifarnik po kategoriji) i, za izabranu mašinu, njene PLANOVE sa stanjem
 * roka. Namjerno nema dugmeta „primijeni na sve mašine“: to bi tiho prepisalo planove koje je neko
 * ručno prilagodio (npr. bager radi 400 h, a kamion 250 h), a razlika je poslovna, ne greška.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import {
  Alert,
  Button,
  Card,
  DataTable,
  FormGrid,
  FormSection,
  Input,
  Select,
  Stack,
  StatusDot,
} from "@/components/ui/index";
import { BASIS_LABEL, MAINTENANCE_STATUS_LABEL, MAINTENANCE_STATUS_TONE } from "../servis-shared";

type TemplateRow = {
  id: string;
  category_name: string | null;
  code: string;
  name: string;
  basis: string;
  interval_value: string;
  tolerance_pct: string;
  is_active: boolean;
};

type PlanRow = {
  id: string;
  machine_id: string;
  name: string;
  basis: string;
  interval_value: string;
  tolerance_pct: string;
  next_due_at: string | null;
  next_due_meter: string | null;
  status: string;
  current_meter: string | null;
  remaining: string | null;
  is_active: boolean;
};

type MachineOption = { id: string; code: string; name: string };

export function PlanoviClient({
  initialTemplates,
  caps,
}: {
  initialTemplates: TemplateRow[];
  caps: { canManage: boolean };
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [machineId, setMachineId] = useState("");
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", basis: "HOURS", intervalValue: "", tolerancePct: "10" });
  const [planForm, setPlanForm] = useState({ name: "", basis: "HOURS", intervalValue: "", nextDueMeter: "", nextDueAt: "" });

  useEffect(() => setTemplates(initialTemplates), [initialTemplates]);

  useEffect(() => {
    void (async () => {
      const equipment = await apiCall<{ machines: MachineOption[] }>("/api/equipment");
      if (equipment.ok) {
        setMachines(equipment.data.machines.map((m) => ({ id: m.id, code: m.code, name: m.name })));
      }
    })();
  }, []);

  const loadPlans = useCallback(async (id: string) => {
    if (!id) {
      setPlans([]);
      return;
    }
    const result = await apiCall<{ plans: PlanRow[] }>(`/api/machines/${id}/maintenance-plans`);
    if (result.ok) setPlans(result.data.plans);
  }, []);

  useEffect(() => { void loadPlans(machineId); }, [loadPlans, machineId]);

  const createTemplate = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall<{ id: string }>(
      "/api/maintenance-templates",
      jsonBody({
        code: form.code,
        name: form.name,
        basis: form.basis,
        intervalValue: form.intervalValue,
        tolerancePct: form.tolerancePct || "10",
      }),
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({ tone: "success", text: "Šablon je dodan." });
    setForm({ code: "", name: "", basis: "HOURS", intervalValue: "", tolerancePct: "10" });
    router.refresh();
  };

  const createPlan = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall<{ id: string }>(
      `/api/machines/${machineId}/maintenance-plans`,
      jsonBody({
        name: planForm.name,
        basis: planForm.basis,
        intervalValue: planForm.intervalValue,
        ...(planForm.nextDueMeter ? { nextDueMeter: planForm.nextDueMeter } : {}),
        ...(planForm.nextDueAt ? { nextDueAt: planForm.nextDueAt } : {}),
      }),
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({ tone: "success", text: "Plan je dodan mašini." });
    setPlanForm({ name: "", basis: "HOURS", intervalValue: "", nextDueMeter: "", nextDueAt: "" });
    void loadPlans(machineId);
  };

  const togglePlan = async (plan: PlanRow) => {
    setBusy(true);
    const result = await apiCall<{ id: string }>(
      `/api/machines/${machineId}/maintenance-plans/${plan.id}`,
      patchBody({ isActive: !plan.is_active }),
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    void loadPlans(machineId);
  };

  const templateColumns = useMemo(
    () => [
      { key: "code", header: "Šifra", cell: (row: TemplateRow) => row.code },
      { key: "name", header: "Naziv", cell: (row: TemplateRow) => row.name },
      { key: "category", header: "Kategorija", cell: (row: TemplateRow) => row.category_name ?? "Sve" },
      { key: "basis", header: "Osnov", cell: (row: TemplateRow) => BASIS_LABEL[row.basis] ?? row.basis },
      {
        key: "interval",
        header: "Interval",
        numeric: true,
        cell: (row: TemplateRow) => `${row.interval_value} ${BASIS_LABEL[row.basis] ?? ""}`.trim(),
      },
      { key: "tolerance", header: "Tolerancija", numeric: true, cell: (row: TemplateRow) => `${row.tolerance_pct} %` },
    ],
    [],
  );

  return (
    <Stack gap="var(--space-5)">
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}

      <Card>
        <FormSection title="Šabloni po kategoriji">
          <DataTable
            columns={templateColumns}
            rows={templates}
            rowKey={(row) => row.id}
            caption="Šabloni preventivnog održavanja"
            emptyText="Nema šablona. Dodajte prvi — „zamjena ulja svakih 250 h“."
          />
          {caps.canManage ? (
            <FormGrid>
              <Input label="Šifra" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
              <Input label="Naziv" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              <Select label="Osnov" value={form.basis} onChange={(event) => setForm({ ...form, basis: event.target.value })}>
                <option value="HOURS">Sati rada</option>
                <option value="KM">Kilometri</option>
                <option value="DAYS">Dani</option>
              </Select>
              <Input
                label="Interval"
                inputMode="decimal"
                value={form.intervalValue}
                onChange={(event) => setForm({ ...form, intervalValue: event.target.value })}
              />
              <Input
                label="Tolerancija (%)"
                inputMode="decimal"
                value={form.tolerancePct}
                onChange={(event) => setForm({ ...form, tolerancePct: event.target.value })}
                hint="Koliko prije roka se javlja upozorenje."
              />
            </FormGrid>
          ) : null}
          {caps.canManage ? (
            <Button
              variant="secondary"
              disabled={busy || !form.code || !form.name || !form.intervalValue}
              onClick={() => void createTemplate()}
            >
              Dodaj šablon
            </Button>
          ) : null}
        </FormSection>
      </Card>

      <Card>
        <FormSection title="Planovi mašine">
          <Select label="Mašina" value={machineId} onChange={(event) => setMachineId(event.target.value)}>
            <option value="">Izaberite mašinu</option>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>{machine.code} — {machine.name}</option>
            ))}
          </Select>
          {machineId ? (
            <DataTable
              columns={[
                { key: "name", header: "Plan", cell: (row: PlanRow) => row.name },
                {
                  key: "status",
                  header: "Stanje",
                  cell: (row: PlanRow) => (
                    <StatusDot
                      tone={MAINTENANCE_STATUS_TONE[row.status] ?? "muted"}
                      label={MAINTENANCE_STATUS_LABEL[row.status] ?? row.status}
                    />
                  ),
                },
                {
                  key: "due",
                  header: "Sljedeći rok",
                  cell: (row: PlanRow) => row.next_due_at ?? (row.next_due_meter ? `${row.next_due_meter} h` : "—"),
                },
                { key: "meter", header: "Brojilo", numeric: true, cell: (row: PlanRow) => row.current_meter ?? "—" },
                { key: "remaining", header: "Ostalo", numeric: true, cell: (row: PlanRow) => row.remaining ?? "—" },
                {
                  key: "actions",
                  header: "",
                  cell: (row: PlanRow) =>
                    caps.canManage ? (
                      <Button variant="quiet" disabled={busy} onClick={() => void togglePlan(row)}>
                        {row.is_active ? "Isključi" : "Uključi"}
                      </Button>
                    ) : null,
                },
              ]}
              rows={plans}
              rowKey={(row) => row.id}
              caption="Planovi preventivnog održavanja mašine"
              emptyText="Mašina nema plan preventivnog održavanja."
            />
          ) : null}
          {caps.canManage && machineId ? (
            <>
              <FormGrid>
                <Input label="Naziv plana" value={planForm.name} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} />
                <Select label="Osnov" value={planForm.basis} onChange={(event) => setPlanForm({ ...planForm, basis: event.target.value })}>
                  <option value="HOURS">Sati rada</option>
                  <option value="KM">Kilometri</option>
                  <option value="DAYS">Dani</option>
                </Select>
                <Input
                  label="Interval"
                  inputMode="decimal"
                  value={planForm.intervalValue}
                  onChange={(event) => setPlanForm({ ...planForm, intervalValue: event.target.value })}
                />
                <Input
                  label="Prvi rok (sati)"
                  inputMode="decimal"
                  value={planForm.nextDueMeter}
                  onChange={(event) => setPlanForm({ ...planForm, nextDueMeter: event.target.value })}
                />
                <Input
                  label="Prvi rok (datum)"
                  type="date"
                  value={planForm.nextDueAt}
                  onChange={(event) => setPlanForm({ ...planForm, nextDueAt: event.target.value })}
                />
              </FormGrid>
              <Button
                variant="secondary"
                disabled={busy || !planForm.name || !planForm.intervalValue}
                onClick={() => void createPlan()}
              >
                Dodaj plan mašini
              </Button>
            </>
          ) : null}
        </FormSection>
      </Card>
    </Stack>
  );
}

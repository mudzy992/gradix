"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/api-client";
import { formatDateTime } from "@/format";
import { Alert, Button, DataTable, EmptyState, FilterBar, Select, Skeleton, Stack } from "@/components/ui/index";
import type { DailyCheckAttachmentRow, DailyCheckRow } from "@/server/daily-check-types";
import { DailyCheckCreate } from "./daily-check-create";
import { DailyCheckRevise } from "./daily-check-revise";
import { CheckTemplatesPanel } from "./check-templates-panel";

type TemplateItem = { key: string; label: string; required: boolean; critical: boolean };
type Template = { id: string; name: string; items: TemplateItem[] };

type Caps = { canCreate: boolean; canRevise: boolean; canManageTemplates: boolean };
type MachineOption = { id: string; code: string; name: string };
type WorkerOption = { id: string; firstName: string; lastName: string };

const RESULT_LABEL: Record<DailyCheckRow["result"], string> = {
  PASS: "Prošao",
  FAIL: "Nije prošao",
  CONDITIONAL: "Uvjetno",
};

export function DailyChecksClient({
  initialChecks,
  caps,
}: {
  initialChecks: DailyCheckRow[];
  caps: Caps;
}) {
  const router = useRouter();
  const [checks, setChecks] = useState(initialChecks);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [machineFilter, setMachineFilter] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<DailyCheckAttachmentRow[]>([]);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadOptions = useCallback(async () => {
    const equipment = await apiCall<{ machines: MachineOption[] }>("/api/equipment");
    if (equipment.ok) {
      setMachines(equipment.data.machines.map((m) => ({ id: m.id, code: m.code, name: m.name })));
    }
    const templateList = await apiCall<{ templates: Template[] }>("/api/check-templates");
    if (templateList.ok) setTemplates(templateList.data.templates);
    if (!caps.canCreate) return;
    const roster = await apiCall<{ workers: WorkerOption[] }>("/api/workers");
    if (roster.ok) {
      setWorkers(roster.data.workers.map((w) => ({
        id: w.id, firstName: w.firstName, lastName: w.lastName,
      })));
    }
  }, [caps.canCreate]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => { setChecks(initialChecks); }, [initialChecks]);

  const refresh = () => {
    router.refresh();
    setChecks(initialChecks);
  };

  const loadAttachments = useCallback(async (checkId: string) => {
    setSelectedId(checkId);
    const res = await apiCall<{ attachments: DailyCheckAttachmentRow[] }>(
      `/api/machine-daily-checks/${checkId}/attachments`,
    );
    if (res.ok) setAttachments(res.data.attachments);
    else setAttachments([]);
  }, []);

  const openAttachment = async (checkId: string, attachmentId: string) => {
    const res = await apiCall<{ url: string }>(
      `/api/machine-daily-checks/${checkId}/attachments/${attachmentId}/url`,
    );
    if (!res.ok) {
      setNotice({ tone: "error", text: res.message });
      return;
    }
    window.open(res.data.url, "_blank", "noopener,noreferrer");
  };

  const visible = useMemo(() => {
    return checks.filter((row) => {
      if (machineFilter && row.machine_id !== machineFilter) return false;
      if (resultFilter && row.result !== resultFilter) return false;
      return true;
    });
  }, [checks, machineFilter, resultFilter]);

  const columns = useMemo(() => {
    const base: Parameters<typeof DataTable<DailyCheckRow>>[0]["columns"] = [
      { key: "machine", header: "Mašina", cell: (row) => `${row.machine_code} — ${row.machine_name}` },
      { key: "worker", header: "Rukovalac", cell: (row) => row.worker_name },
      { key: "checked", header: "Vrijeme", cell: (row) => formatDateTime(row.checked_at) },
      { key: "result", header: "Ishod", cell: (row) => RESULT_LABEL[row.result] },
      {
        key: "photo",
        header: "Fotografija",
        cell: (row) => {
          /*
           * Potvrda fotografije je ZASEBNA radnja: prilog traži `check_id`, pa slika ne može
           * stići u istom zahtjevu kao pregled. Dok potvrde nema, nalaz je otvoren.
           */
          if (!row.photo_required) return "—";
          if (row.photo_confirmed_at) return "potvrđena";
          return (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await apiCall<{ outcome: string; id: string }>(
                  `/api/machine-daily-checks/${row.id}/photo`,
                  { method: "POST" },
                );
                setBusy(false);
                if (!res.ok) {
                  setNotice({ tone: "error", text: res.message });
                  return;
                }
                setNotice({ tone: "success", text: "Fotografija je potvrđena." });
                refresh();
              }}
            >
              Potvrdi fotografiju
            </Button>
          );
        },
      },
      { key: "fault", header: "Kvar", cell: (row) => (row.fault_id ? "otvoren" : "—") },
      { key: "note", header: "Napomena", cell: (row) => row.note ?? "—" },
      {
        key: "photos",
        header: "Prilozi",
        cell: (row) => (
          <Button variant="quiet" onClick={() => void loadAttachments(row.id)}>Prikaži</Button>
        ),
      },
    ];
    if (caps.canRevise) {
      base.push({
        key: "actions",
        header: "",
        cell: (row) => (
          <DailyCheckRevise
            check={row}
            busy={busy}
            onBusy={setBusy}
            onDone={() => { setNotice({ tone: "success", text: "Ispravka je zapisana." }); refresh(); }}
            onError={(text) => setNotice({ tone: "error", text })}
          />
        ),
      });
    }
    return base;
  }, [busy, caps.canRevise, loadAttachments]);

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
        <Select label="Ishod" value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
          <option value="">Svi</option>
          <option value="PASS">Prošao</option>
          <option value="FAIL">Nije prošao</option>
          <option value="CONDITIONAL">Uvjetno</option>
        </Select>
        {caps.canCreate ? (
          <DailyCheckCreate
            machines={machines.filter((m) => m.id)}
            workers={workers}
            templates={templates}
            busy={busy}
            onBusy={setBusy}
            onCreated={() => { setNotice({ tone: "success", text: "Unos je sačuvan." }); refresh(); }}
            onError={(text) => setNotice({ tone: "error", text })}
          />
        ) : null}
      </FilterBar>
      <DataTable
        caption="Dnevni pregledi"
        rows={visible}
        rowKey={(row) => row.id}
        columns={columns}
        empty={visible.length === 0 ? (
          <EmptyState
            title="Nema dnevnih pregleda"
            description="Unosi s terena i ureda pojave se ovdje."
          />
        ) : undefined}
      />
      <CheckTemplatesPanel canManage={caps.canManageTemplates} />
      {selectedId ? (
        <Stack gap="var(--space-2)">
          <Alert tone="info" role="status">Prilozi pregleda — otvori link (API URL).</Alert>
          {attachments.length === 0 ? (
            <EmptyState title="Nema priloga" description="Još nema potvrđenih fotografija." />
          ) : null}
          {attachments.map((att) => (
            <Button
              key={att.id}
              variant="quiet"
              onClick={() => void openAttachment(selectedId, att.id)}
            >
              {att.fileName} ({att.status})
            </Button>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

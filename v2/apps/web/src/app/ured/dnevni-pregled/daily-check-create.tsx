"use client";

import { useState } from "react";
import { calendarDateFromLocalDate } from "@gradix/domain";
import { apiCall, jsonBody } from "@/api-client";
import { Alert, Button, Dialog, Input, Select, Textarea } from "@/components/ui/index";

type MachineOption = { id: string; code: string; name: string };
type WorkerOption = { id: string; firstName: string; lastName: string };
type Outcome = { outcome: string; message?: string; code?: string };

type TemplateItem = { key: string; label: string; required: boolean; critical: boolean };
type Template = { id: string; name: string; items: TemplateItem[] };

/**
 * Unos pregleda PO ŠABLONU (spec 05 §1.5.20).
 *
 * Šablon se bira po kategoriji mašine, a ako ga nema, pregled ostaje slobodan (kao do F4) — ali
 * tada nema ni kritičnih stavki. Ekran NE blokira rad kad kritična stavka padne: pokazuje šta
 * će se desiti (fotografija + kvar), a odluku o radu donosi čovjek.
 */
export function DailyCheckCreate({
  machines,
  workers,
  templates,
  busy,
  onBusy,
  onCreated,
  onError,
}: {
  machines: MachineOption[];
  workers: WorkerOption[];
  templates: Template[];
  busy: boolean;
  onBusy: (value: boolean) => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = calendarDateFromLocalDate(new Date());
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [workerId, setWorkerId] = useState(workers[0]?.id ?? "");
  const [checkedAt, setCheckedAt] = useState(`${today}T07:00`);
  const [result, setResult] = useState<"PASS" | "FAIL" | "CONDITIONAL">("PASS");
  const [note, setNote] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [checklist, setChecklist] = useState<Record<string, "PASS" | "FAIL">>({});

  const template = templates.find((entry) => entry.id === templateId) ?? null;
  const criticalFailed = (template?.items ?? []).filter(
    (item) => item.critical && checklist[item.key] === "FAIL",
  );

  const submit = async () => {
    if (!machineId) {
      onError("Mašina je obavezna.");
      return;
    }
    onBusy(true);
    setOpen(false);
    const body = {
      machineId,
      workerId: workers.length > 0 ? workerId : null,
      checkedAt: checkedAt.includes("T") ? `${checkedAt}:00+01:00` : `${checkedAt}T07:00:00+01:00`,
      result,
      // Rezultat po stavci ide u `checklist_json`; kritične `FAIL` stavke servis izvlači po
      // ključu iz šablona i otvara kvar.
      checklistJson: checklist,
      templateId: templateId || null,
      note: note.trim() || null,
    };
    const res = await apiCall<Outcome>("/api/machine-daily-checks", jsonBody(body));
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    if (res.data.outcome !== "OK") {
      onError(res.data.message ?? res.data.code ?? "Unos nije uspio.");
      return;
    }
    onCreated();
  };

  return (
    <>
      <Button variant="primary" icon="plus" disabled={busy || machines.length === 0} onClick={() => setOpen(true)}>
        Novi unos
      </Button>
      {open ? (
        <Dialog
          title="Unos dnevnog pregleda"
          onClose={() => setOpen(false)}
          footer={(
            <div className="gx-dialog__actions">
              <Button variant="quiet" onClick={() => setOpen(false)} disabled={busy}>Odustani</Button>
              <Button variant="primary" onClick={() => void submit()} disabled={busy}>
                {busy ? "Radim…" : "Sačuvaj"}
              </Button>
            </div>
          )}
        >
          <Select label="Mašina" value={machineId} onChange={(event) => setMachineId(event.target.value)}>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>{machine.code} — {machine.name}</option>
            ))}
          </Select>
          {workers.length > 0 ? (
            <Select label="Rukovalac" value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>{worker.firstName} {worker.lastName}</option>
              ))}
            </Select>
          ) : null}
          <Input label="Vrijeme" type="datetime-local" value={checkedAt} onChange={(e) => setCheckedAt(e.target.value)} />
          <Select label="Ishod" value={result} onChange={(event) => setResult(event.target.value as typeof result)}>
            <option value="PASS">Prošao</option>
            <option value="FAIL">Nije prošao</option>
            <option value="CONDITIONAL">Uvjetno</option>
          </Select>
          {templates.length > 0 ? (
            <Select
              label="Šablon pregleda"
              value={templateId}
              onChange={(event) => { setTemplateId(event.target.value); setChecklist({}); }}
            >
              <option value="">Bez šablona (slobodan unos)</option>
              {templates.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.name}</option>
              ))}
            </Select>
          ) : null}
          {template ? (
            <div className="gx-card">
              <p className="gx-muted">Stavke šablona — svaka dobija ishod „prošlo" ili „nije prošlo".</p>
              {template.items.map((item) => (
                <Select
                  key={item.key}
                  label={`${item.label}${item.critical ? " (kritično)" : ""}${item.required ? " *" : ""}`}
                  value={checklist[item.key] ?? "PASS"}
                  onChange={(event) =>
                    setChecklist((current) => ({ ...current, [item.key]: event.target.value as "PASS" | "FAIL" }))
                  }
                >
                  <option value="PASS">Prošlo</option>
                  <option value="FAIL">Nije prošlo</option>
                </Select>
              ))}
              {criticalFailed.length > 0 ? (
                /*
                 * Upozorenje, ne blokada: radnja je dopuštena, ali korisnik mora znati da će
                 * pregled tražiti fotografiju i otvoriti kvar. Bez ovoga bi nalaz nestao u
                 * tabeli kao i svaki drugi.
                 */
                <Alert tone="warning" role="status">
                  Kritičan nalaz: {criticalFailed.map((item) => item.label).join(", ")}. Poslije
                  unosa je obavezna fotografija, a kvar se otvara automatski. Rad nije blokiran —
                  odluku donosi šef.
                </Alert>
              ) : null}
            </div>
          ) : null}
          <Textarea label="Napomena" value={note} onChange={(e) => setNote(e.target.value)} />
        </Dialog>
      ) : null}
    </>
  );
}

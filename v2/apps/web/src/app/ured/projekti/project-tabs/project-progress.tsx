"use client";

/**
 * Faze projekta i % završenosti — `MANUAL` (po težinama) ili `BOQ` (iz količina), nikad oba.
 *
 * Zašto težina, a ne prost prosjek: faza „Priprema“ i faza „Asfalt“ ne traju isto. Prost prosjek
 * bi pri 8 završenih pripremnih radova i 0 % asfalta pokazao 80 % — broj koji niko ne bi prepoznao.
 * Kad je izvor `BOQ`, polja za % su ZAKLJUČANA: napredak dolazi iz količina i ručni unos bi ga
 * prepisao bez traga (zato i ruta `PUT /progress` to odbija, ne samo ekran).
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import { formatDate } from "@/format";
import {
  Alert, Button, Card, Chip, DataTable, Dialog, EmptyState, Input, SelectField as Select, Skeleton, Stat,
} from "@/components/ui/index";
import type { PhasesResult } from "@/server/project-phase-types";

type PhaseForm = {
  id?: string;
  code: string;
  name: string;
  weight: string;
  sortOrder: string;
  plannedStart: string;
  plannedEnd: string;
};

const EMPTY: PhaseForm = { code: "", name: "", weight: "10", sortOrder: "0", plannedStart: "", plannedEnd: "" };

export function ProjectProgress({
  projectId,
  canManage,
  onChanged,
}: {
  projectId: string;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<PhasesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<PhaseForm | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const result = await apiCall<PhasesResult>(`/api/projects/${projectId}/phases`);
    if (!result.ok) {
      setError(result.message);
      setData(null);
      return;
    }
    setData(result.data);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    const body = {
      code: form.code.trim(),
      name: form.name.trim(),
      weight: Number(form.weight),
      sortOrder: Number(form.sortOrder),
      plannedStart: form.plannedStart || null,
      plannedEnd: form.plannedEnd || null,
      ...(form.id ? { id: form.id } : {}),
    };
    const result = form.id
      ? await apiCall<PhasesResult>(`/api/projects/${projectId}/phases`, patchBody(body))
      : await apiCall<PhasesResult>(`/api/projects/${projectId}/phases`, jsonBody(body));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setForm(null);
    setData(result.data);
    onChanged?.();
  }

  async function saveProgress() {
    const phases = Object.entries(draft);
    if (phases.length === 0) return;
    setBusy(true);
    setError(null);
    const result = await apiCall<PhasesResult>(`/api/projects/${projectId}/progress`, {
      ...patchBody({ phases: phases.map(([id, value]) => ({ id, progressPct: Number(value) })) }),
      method: "PUT",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft({});
    setData(result.data);
    onChanged?.();
  }

  if (error && data === null) return <Alert tone="error">{error}</Alert>;
  if (data === null) return <Skeleton rows={4} />;

  const isBoq = data.progress_source === "BOQ";
  const dirty = Object.keys(draft).length > 0;

  return (
    <div className="gx-stack">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="gx-cols">
        <Stat
          label="Ukupan napredak"
          value={data.progress_pct === null ? "—" : `${data.progress_pct.toFixed(1)} %`}
          hint={
            data.progress_pct === null
              ? "Bez faza nema ni procenta — dodajte faze sa težinama."
              : isBoq
                ? "Računa se iz izvedenih količina u predmjeru."
                : "Ponderisano po težini faza."
          }
        />
        <Stat label="Izvor napretka" value={isBoq ? "Predmjer (količine)" : "Ručno po fazama"} />
      </div>

      {canManage ? (
        <div className="gx-inline-flex">
          <Button variant="primary" onClick={() => setForm({ ...EMPTY })}>
            + Nova faza
          </Button>
          {isBoq ? null : (
            <Button variant="secondary" disabled={!dirty || busy} onClick={() => void saveProgress()}>
              Sačuvaj procente
            </Button>
          )}
        </div>
      ) : null}

      {data.phases.length === 0 ? (
        <EmptyState
          title="Nema faza"
          description="Faze nose težine po kojima se računa procenat. Bez njih projekat nema napredak."
        />
      ) : (
        <DataTable
          caption="Faze projekta"
          rows={data.phases}
          rowKey={(phase) => phase.id}
          emptyText="Nema faza."
          columns={[
            {
              key: "phase",
              header: "Faza",
              cell: (phase) => (
                <span className="gx-stack gx-stack--2">
                  <span>{phase.name}</span>
                  <Chip tone="hollow">{phase.code}</Chip>
                </span>
              ),
            },
            { key: "weight", header: "Težina", numeric: true, cell: (phase) => String(phase.weight) },
            {
              key: "share",
              header: "Udio",
              numeric: true,
              cell: (phase) => `${(phase.weighted_share * 100).toFixed(1)} %`,
            },
            {
              key: "progress",
              header: "Napredak",
              cell: (phase) =>
                isBoq || !canManage ? (
                  <span>{phase.progress_pct.toFixed(0)} %</span>
                ) : (
                  <Input
                    label={`Napredak faze ${phase.name}`}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={draft[phase.id] ?? String(phase.progress_pct)}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [phase.id]: event.target.value }))
                    }
                  />
                ),
            },
            {
              key: "planned",
              header: "Plan",
              cell: (phase) => (
                <span className="gx-stack gx-stack--2">
                  {formatDate(phase.planned_start)} – {formatDate(phase.planned_end)}
                  {phase.dependency_warnings.length > 0 ? (
                    <Chip tone="hot">Zavisnost još nije završena</Chip>
                  ) : null}
                </span>
              ),
            },
          ]}
          rowActionLabel={(phase) => `Više radnji za fazu ${phase.name}`}
          actions={(phase) =>
            canManage
              ? [
                  {
                    key: "edit",
                    label: "Izmijeni fazu",
                    onSelect: () =>
                      setForm({
                        id: phase.id,
                        code: phase.code,
                        name: phase.name,
                        weight: String(phase.weight),
                        sortOrder: String(phase.sort_order),
                        plannedStart: phase.planned_start ?? "",
                        plannedEnd: phase.planned_end ?? "",
                      }),
                  },
                ]
              : []
          }
        />
      )}

      {canManage ? (
        <ProgressSourceSwitch projectId={projectId} source={data.progress_source} onChanged={load} />
      ) : null}

      {form ? (
        <Dialog
          title={form.id ? "Izmjena faze" : "Nova faza"}
          hint="Težina je 1–1000 i važi samo dok je izvor napretka „ručno“. Ako se izvor promijeni u predmjer, % dolazi iz količina."
          returnFocusTo={null}
          onClose={() => setForm(null)}
        >
          <form className="gx-stack" onSubmit={submit}>
            <Input
              label="Šifra"
              required
              maxLength={20}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
            <Input
              label="Naziv"
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <Input
              label="Težina (1–1000)"
              type="number"
              min={1}
              max={1000}
              required
              value={form.weight}
              onChange={(event) => setForm({ ...form, weight: event.target.value })}
            />
            <Input
              label="Redoslijed"
              type="number"
              min={0}
              value={form.sortOrder}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            />
            <Input
              label="Planirani početak"
              type="date"
              value={form.plannedStart}
              onChange={(event) => setForm({ ...form, plannedStart: event.target.value })}
            />
            <Input
              label="Planirani kraj"
              type="date"
              value={form.plannedEnd}
              onChange={(event) => setForm({ ...form, plannedEnd: event.target.value })}
            />
            <div className="gx-inline-flex gx-mt-2">
              <Button variant="quiet" onClick={() => setForm(null)}>
                Otkaži
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                Sačuvaj fazu
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

/** Prekidač izvora napretka — jedna vrijednost zamjenjuje drugu, pa `PUT`. */
function ProgressSourceSwitch({
  projectId,
  source,
  onChanged,
}: {
  projectId: string;
  source: "MANUAL" | "BOQ";
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(next: "MANUAL" | "BOQ") {
    if (next === source) return;
    setBusy(true);
    setError(null);
    const result = await apiCall<unknown>(`/api/projects/${projectId}/progress-source`, {
      ...patchBody({ progressSource: next }),
      method: "PUT",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    await onChanged();
  }

  return (
    <Card>
      <div className="gx-stack">
        <Select
          label="Izvor napretka"
          hint="Predmjer znači da % dolazi iz izvedenih količina; ručno znači da ga upisujete po fazama. Nikad oba."
          value={source}
          disabled={busy}
          onChange={(event) => void change(event.target.value as "MANUAL" | "BOQ")}
        >
          <option value="MANUAL">Ručno po fazama (težine)</option>
          <option value="BOQ">Iz predmjera (količine)</option>
        </Select>
        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>
    </Card>
  );
}

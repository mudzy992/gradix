"use client";

/**
 * Predmjer (tab 4) — planirane i izvedene količine; kad je izvor napretka `BOQ`, procenat projekta
 * dolazi ODAVDE. Zato ekran pokazuje i `progress_pct` koji iz količina izlazi, a ne samo tabele:
 * bez toga veza „količina → procenat projekta“ nije vidljiva onome ko unosi.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Chip, DataTable, Dialog, EmptyState, Input, Skeleton, Stat, Textarea,
} from "@/components/ui/index";
import type { BoqItemRow, BoqResult } from "@/server/project-finance-types";
import type { PhaseRowLite } from "./budget-types";

type BoqForm = {
  id?: string;
  phaseId: string;
  code: string;
  description: string;
  unit: string;
  quantityPlanned: string;
  unitPrice: string;
  quantityExecuted: string;
};

const EMPTY: BoqForm = {
  phaseId: "",
  code: "",
  description: "",
  unit: "m3",
  quantityPlanned: "",
  unitPrice: "",
  quantityExecuted: "0",
};

export function ProjectBoq({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [boq, setBoq] = useState<BoqResult | null>(null);
  const [, setPhases] = useState<PhaseRowLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<BoqForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [boqResult, phaseResult] = await Promise.all([
      apiCall<BoqResult>(`/api/projects/${projectId}/boq`),
      apiCall<{ phases: PhaseRowLite[] }>(`/api/projects/${projectId}/phases`),
    ]);
    if (!boqResult.ok) {
      setError(boqResult.message);
      setBoq(null);
      return;
    }
    setBoq(boqResult.data);
    if (phaseResult.ok) setPhases(phaseResult.data.phases);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    const result = await apiCall<BoqResult>(`/api/projects/${projectId}/boq`, {
      ...jsonBody({
        ...(form.id ? { id: form.id } : {}),
        phaseId: form.phaseId || null,
        code: form.code.trim(),
        description: form.description.trim(),
        unit: form.unit.trim(),
        quantityPlanned: Number(form.quantityPlanned),
        unitPrice: form.unitPrice,
        quantityExecuted: Number(form.quantityExecuted || "0"),
      }),
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setForm(null);
    setMessage("Predmjer je sačuvan. Ako je izvor napretka „predmjer“, procenat se odmah preračunao.");
    await load();
  }

  if (error && boq === null) return <Alert tone="error">{error}</Alert>;
  if (boq === null) return <Skeleton rows={5} />;

  return (
    <div className="gx-stack">
      {message ? <Alert tone="success" role="status">{message}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="gx-cols">
        <Stat label="Planirano" value={boq.totals.planned} hint={`Valuta: ${boq.totals.currency_code}`} />
        <Stat label="Izvedeno" value={boq.totals.executed} />
        <Stat
          label="Napredak iz količina"
          value={boq.progress_pct === null ? "—" : `${boq.progress_pct.toFixed(1)} %`}
          hint={
            boq.progress_source === "BOQ"
              ? "Izvor napretka je predmjer — ovaj broj ide u listu projekata."
              : "Izvor napretka je ručno po fazama; ovaj broj je informativan."
          }
        />
      </div>

      {boq.progress_source !== "BOQ" ? (
        <Alert tone="info" role="status">
          Napredak projekta se trenutno računa ručno po fazama. Količine ovdje ne mijenjaju
          procenat dok se izvor ne prebaci na „predmjer“ u tabu Pregled.
        </Alert>
      ) : null}

      {canManage ? (
        <div className="gx-inline-flex">
          <Button variant="primary" onClick={() => setForm({ ...EMPTY })}>
            + Nova stavka
          </Button>
        </div>
      ) : null}

      {boq.items.length === 0 ? (
        <EmptyState
          title="Predmjer je prazan"
          description="Stavke nose količine i jedinične cijene. Iz njih se, kad je izvor napretka „predmjer“, računa procenat projekta."
        />
      ) : (
        <DataTable
          caption="Stavke predmjera"
          rows={boq.items}
          rowKey={(item) => item.id}
          emptyText="Nema stavki."
          columns={[
            {
              key: "item",
              header: "Stavka",
              cell: (item: BoqItemRow) => (
                <span className="gx-stack gx-stack--2">
                  <span>{item.description}</span>
                  <span className="gx-page-sub">
                    {item.code}
                    {item.phase_name ? ` · ${item.phase_name}` : ""}
                  </span>
                </span>
              ),
            },
            {
              key: "quantity",
              header: "Količina (plan / izvedeno)",
              numeric: true,
              cell: (item) => (
                <span className="gx-stack gx-stack--2">
                  <span>
                    {item.quantity_planned} {item.unit} / {item.quantity_executed} {item.unit}
                  </span>
                  {item.quantity_executed > item.quantity_planned ? (
                    <Chip tone="hot">više od plana</Chip>
                  ) : null}
                </span>
              ),
            },
            { key: "price", header: "Jed. cijena", numeric: true, cell: (item) => item.unit_price },
            { key: "total", header: "Ukupno izvedeno", numeric: true, cell: (item) => item.total_executed },
          ]}
          rowActionLabel={(item) => `Više radnji za stavku ${item.code}`}
          actions={(item) =>
            canManage
              ? [
                  {
                    key: "edit",
                    label: "Izmijeni / upiši izvedeno",
                    onSelect: () =>
                      setForm({
                        id: item.id,
                        phaseId: item.phase_id ?? "",
                        code: item.code,
                        description: item.description,
                        unit: item.unit,
                        quantityPlanned: String(item.quantity_planned),
                        unitPrice: item.unit_price,
                        quantityExecuted: String(item.quantity_executed),
                      }),
                  },
                ]
              : []
          }
        />
      )}

      {form ? (
        <Dialog
          title={form.id ? "Izmjena stavke predmjera" : "Nova stavka predmjera"}
          returnFocusTo={null}
          onClose={() => setForm(null)}
        >
          <form className="gx-stack" onSubmit={submit}>
            <Input
              label="Šifra"
              required
              maxLength={30}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
            <Textarea
              label="Opis"
              required
              rows={2}
              maxLength={500}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
            <Input
              label="Jedinica"
              required
              maxLength={10}
              value={form.unit}
              onChange={(event) => setForm({ ...form, unit: event.target.value })}
            />
            <Input
              label="Planirana količina"
              required
              inputMode="decimal"
              value={form.quantityPlanned}
              onChange={(event) => setForm({ ...form, quantityPlanned: event.target.value })}
            />
            <Input
              label="Jedinična cijena"
              required
              inputMode="decimal"
              hint="Dvije decimale, npr. 45.00."
              value={form.unitPrice}
              onChange={(event) => setForm({ ...form, unitPrice: event.target.value })}
            />
            <Input
              label="Izvedena količina"
              inputMode="decimal"
              value={form.quantityExecuted}
              onChange={(event) => setForm({ ...form, quantityExecuted: event.target.value })}
            />
            <div className="gx-inline-flex gx-mt-2">
              <Button variant="quiet" onClick={() => setForm(null)}>
                Otkaži
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                Sačuvaj stavku
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

"use client";

/**
 * Budžet projekta (tab 3) — po revizijama, po kategorijama i fazama.
 *
 * Budžet se NIKAD ne prepisuje: „izmjena“ je nova revizija sa `valid_from`. Zato ekran prikazuje
 * reviziju koju gledate i dugme „Nova revizija“; stare revizije ostaju za uporedbu i za audit.
 *
 * Potrošnja je `POSTED` trošak; `PENDING` je rizik odvojen od iznosa. Prag 80 % / 100 % je isti
 * onaj koji worker koristi za obavještenja — ekran ga samo pokazuje, ne računa svoj.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { formatDate } from "@/format";
import {
  Alert, Button, Card, Chip, DataTable, Dialog, EmptyState, Input, Select, Skeleton, Stat, Textarea,
} from "@/components/ui/index";
import type { BudgetResult, CategoryRow, PhaseRowLite } from "./budget-types";

export function ProjectBudget({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [budget, setBudget] = useState<BudgetResult | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [phases, setPhases] = useState<PhaseRowLite[]>([]);
  const [revision, setRevision] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Array<{ phaseId: string; categoryId: string; amount: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const query = revision === "" ? "" : `?revision=${revision}`;
    const [budgetResult, categoryResult, phaseResult] = await Promise.all([
      apiCall<BudgetResult>(`/api/projects/${projectId}/budget${query}`),
      apiCall<{ categories: CategoryRow[] }>("/api/cost-categories"),
      apiCall<{ phases: PhaseRowLite[] }>(`/api/projects/${projectId}/phases`),
    ]);
    if (!budgetResult.ok) {
      setError(budgetResult.message);
      setBudget(null);
      return;
    }
    setBudget(budgetResult.data);
    if (categoryResult.ok) setCategories(categoryResult.data.categories.filter((c) => c.is_active));
    if (phaseResult.ok) setPhases(phaseResult.data.phases);
  }, [projectId, revision]);

  useEffect(() => {
    void load();
  }, [load]);

  function startRevision() {
    if (!budget) return;
    const next = budget.revision + 1;
    // Nova revizija počinje kao KOPIJA tekuće: prazan budžet bi izbrisao plan iz vida.
    setLines(
      budget.lines.map((line) => ({
        phaseId: line.phase_id ?? "",
        categoryId: line.category_id,
        amount: line.amount,
      })),
    );
    setNote(budget.revision === 0 ? "" : `Revizija ${next}`);
    setEditing(true);
  }

  async function submitRevision(event: React.FormEvent) {
    event.preventDefault();
    if (lines.length === 0) return;
    setBusy(true);
    setError(null);
    const result = await apiCall<BudgetResult>(`/api/projects/${projectId}/budget`, {
      ...jsonBody({
        lines: lines
          .filter((line) => line.categoryId !== "" && line.amount.trim() !== "")
          .map((line) => ({
            phaseId: line.phaseId || null,
            categoryId: line.categoryId,
            amount: line.amount,
          })),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEditing(false);
    setRevision("");
    setMessage("Nova revizija budžeta je sačuvana. Stare revizije ostaju nepromijenjene.");
    await load();
  }

  if (error && budget === null) return <Alert tone="error">{error}</Alert>;
  if (budget === null) return <Skeleton rows={5} />;

  return (
    <div className="gx-stack">
      {message ? <Alert tone="success" role="status">{message}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="gx-cols">
        <Stat
          label="Budžet (revizija)"
          value={budget.totals.budget}
          hint={budget.revision === 0 ? "Budžet još nije postavljen." : `Revizija ${budget.revision}`}
        />
        <Stat label="Potrošeno (POSTED)" value={budget.totals.spent} hint={`Valuta: ${budget.totals.currency_code}`} />
        <Stat
          label="Bez cijene (PENDING)"
          value={String(budget.totals.pending_count)}
          hint={
            budget.totals.pending_amount === null
              ? "Iznos nije poznat — prikazuje se samo broj zapisa."
              : `${budget.totals.pending_amount} poznatog iznosa`
          }
        />
      </div>

      <div className="gx-inline-flex">
        <Select
          label="Revizija"
          value={revision === "" ? "" : String(revision)}
          onChange={(event) => setRevision(event.target.value === "" ? "" : Number(event.target.value))}
        >
          <option value="">Tekuća ({budget.revision})</option>
          {budget.revisions.map((item) => (
            <option key={item.revision} value={item.revision}>
              Revizija {item.revision} · {formatDate(item.valid_from)}
            </option>
          ))}
        </Select>
        {canManage ? (
          <Button variant="primary" onClick={startRevision}>
            + Nova revizija
          </Button>
        ) : null}
      </div>

      <Card>
        <h2 className="gx-form-section__title">Po kategorijama</h2>
        {budget.totals.by_category.length === 0 ? (
          <p className="gx-page-sub">Nema kategorija troška. Dodajte ih u postavkama.</p>
        ) : (
          <DataTable
            caption="Budžet po kategorijama"
            rows={budget.totals.by_category}
            rowKey={(row) => row.category_id}
            emptyText="Nema kategorija."
            columns={[
              { key: "category", header: "Kategorija", cell: (row) => row.category_name },
              { key: "budget", header: "Budžet", numeric: true, cell: (row) => row.budget },
              { key: "spent", header: "Potrošeno", numeric: true, cell: (row) => row.spent },
              {
                key: "used",
                header: "Iskorišteno",
                cell: (row) => {
                  if (row.used_pct === null) return <span className="gx-page-sub">bez budžeta</span>;
                  const tone = row.threshold_crossed === "100" ? "hot" : "hollow";
                  return (
                    <span className="gx-stack gx-stack--2">
                      <span>{row.used_pct.toFixed(1)} %</span>
                      {row.threshold_crossed ? (
                        <Chip tone={tone}>{row.threshold_crossed === "100" ? "preko budžeta" : "preko 80 %"}</Chip>
                      ) : null}
                    </span>
                  );
                },
              },
            ]}
          />
        )}
      </Card>

      <Card>
        <h2 className="gx-form-section__title">Linije budžeta</h2>
        {budget.lines.length === 0 ? (
          <EmptyState
            title="Nema budžetskih linija"
            description="Budžet se postavlja po kategoriji (i fazi, ako želite detaljnije). Kasnije se mijenja novom revizijom."
          />
        ) : (
          <DataTable
            caption="Linije budžeta"
            rows={budget.lines}
            rowKey={(line) => line.id}
            emptyText="Nema linija."
            columns={[
              { key: "category", header: "Kategorija", cell: (line) => line.category_name },
              { key: "phase", header: "Faza", cell: (line) => line.phase_name ?? "—" },
              { key: "amount", header: "Iznos", numeric: true, cell: (line) => line.amount },
              { key: "valid", header: "Važi od", cell: (line) => formatDate(line.valid_from) },
              { key: "note", header: "Napomena", cell: (line) => line.note ?? "—" },
            ]}
          />
        )}
      </Card>

      {editing ? (
        <Dialog
          title="Nova revizija budžeta"
          hint="Revizija je kopija tekuće — izmijenite samo ono što se mijenja. Prethodne revizije ostaju u historiji."
          returnFocusTo={null}
          onClose={() => setEditing(false)}
        >
          <form className="gx-stack" onSubmit={submitRevision}>
            {lines.map((line, index) => (
              <div key={`${line.categoryId}-${index}`} className="gx-inline-flex">
                <Select
                  label={`Kategorija ${index + 1}`}
                  value={line.categoryId}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, categoryId: event.target.value };
                    setLines(next);
                  }}
                >
                  <option value="">— izaberite —</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Faza"
                  value={line.phaseId}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, phaseId: event.target.value };
                    setLines(next);
                  }}
                >
                  <option value="">Cijeli projekat</option>
                  {phases.map((phase) => (
                    <option key={phase.id} value={phase.id}>
                      {phase.name}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Iznos"
                  inputMode="decimal"
                  value={line.amount}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, amount: event.target.value };
                    setLines(next);
                  }}
                />
                <Button
                  variant="quiet"
                  onClick={() => setLines(lines.filter((_, position) => position !== index))}
                >
                  Ukloni
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() =>
                setLines([...lines, { phaseId: "", categoryId: categories[0]?.id ?? "", amount: "" }])
              }
            >
              + Linija
            </Button>
            <Textarea
              label="Napomena revizije"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="gx-inline-flex gx-mt-2">
              <Button variant="quiet" onClick={() => setEditing(false)}>
                Otkaži
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                Sačuvaj reviziju
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

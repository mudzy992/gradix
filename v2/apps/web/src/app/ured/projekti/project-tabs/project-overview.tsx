"use client";

/**
 * Pregled projekta (tab 1): novac, napredak i zatvaranje na jednom mjestu.
 *
 * Tri stvari koje ovaj ekran NE smije pogriješiti:
 *  1. **EAC je procjena.** Ispisuje se sa oznakom „procjena“ i objašnjenjem; kad je
 *     `amount: null` (nema napretka), broj se NE prikazuje — nula bi bila tvrdnja koju nemamo.
 *  2. **`PENDING` nije trošak.** Broj zapisa bez cijene stoji odvojeno od zbroja, jer se ne sabira
 *     sa novcem (§1.8.29).
 *  3. **Zatvaranje je čin.** Kontrolna lista se pokazuje prije dugmeta; `PENDING` stavka se može
 *     svjesno prihvatiti samo uz razlog, a zatvaranje blokira dalje knjiženje.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Card, Checkbox, Chip, DescriptionList, Dialog, Inline, Skeleton, Stat, Textarea,
} from "@/components/ui/index";
import type { ProfitabilityResult } from "@/server/project-finance-types";
import type { PhasesResult } from "@/server/project-phase-types";
import { ProjectProgress } from "./project-progress";

type Checklist = {
  items: Array<{ key: string; label: string; ok: boolean; count: number; acceptable?: boolean }>;
  complete: boolean;
  blockers: string[];
};

type CloseSnapshot = { id: string; closed_at: string; closed_by_name: string | null };

export function ProjectOverview({
  projectId,
  canManage,
  onOpenTab,
}: {
  projectId: string;
  canManage: boolean;
  onOpenTab: (tab: string) => void;
}) {
  const [money, setMoney] = useState<ProfitabilityResult | null>(null);
  const [phases, setPhases] = useState<PhasesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [closing, setClosing] = useState(false);
  const [pendingReason, setPendingReason] = useState("");
  const [confirmPending, setConfirmPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [moneyResult, phasesResult] = await Promise.all([
      apiCall<ProfitabilityResult>(`/api/projects/${projectId}/profitability`),
      apiCall<PhasesResult>(`/api/projects/${projectId}/phases`),
    ]);
    if (!moneyResult.ok) setError(moneyResult.message);
    else setMoney(moneyResult.data);
    if (phasesResult.ok) setPhases(phasesResult.data);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openChecklist() {
    setBusy(true);
    setError(null);
    const result = await apiCall<Checklist>(`/api/projects/${projectId}/close-checklist`);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setChecklist(result.data);
    setClosing(true);
  }

  async function submitClose() {
    setBusy(true);
    setError(null);
    const result = await apiCall<CloseSnapshot>(`/api/projects/${projectId}/close`, {
      ...jsonBody({ pendingCostsReason: pendingReason.trim().length >= 10 ? pendingReason.trim() : null }),
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setClosing(false);
    setPendingReason("");
    setConfirmPending(false);
    setMessage("Projekat je zatvoren. Nova knjiženja su blokirana do ponovnog otvaranja.");
    await load();
  }

  if (error && money === null) return <Alert tone="error">{error}</Alert>;
  if (money === null) return <Skeleton rows={5} />;

  const eac = money.eac;

  return (
    <div className="gx-stack">
      {message ? <Alert tone="success" role="status">{message}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="gx-cols">
        <Stat
          label="Vrijednost sa aneksima"
          value={money.contract_with_amendments ?? "nije upisana"}
          hint={`Osnovno: ${money.contract_value ?? "—"} · odobreni aneksi: ${money.approved_amendments}`}
        />
        <Stat label="Knjiženi trošak" value={money.posted_cost} hint={`Valuta: ${money.currency_code}`} />
        <Stat
          label="Marža"
          value={money.margin ?? "—"}
          hint={
            money.margin_pct === null
              ? "Bez ugovorene vrijednosti nema procenta."
              : `${money.margin_pct.toFixed(1)} % ugovorene vrijednosti`
          }
        />
        <Stat
          label="Procjena konačnog troška (EAC)"
          value={eac.amount ?? "—"}
          hint={
            eac.amount === null
              ? "Procjena nije moguća pri 0 % napretka — prikazivala bi nulu kao činjenicu."
              : `Procjena, ne knjiga. Računato pri ${eac.progress_pct?.toFixed(1) ?? "—"} % napretka.`
          }
        />
      </div>

      {money.pending_cost_count > 0 ? (
        <Alert tone="warning" role="status">
          {money.pending_cost_count} zapisa još nema cijenu. To nije trošak i ne ulazi u zbroj —
          vidljivo je u tabu Troškovi i u budžetu kao rizik, ne kao iznos.
        </Alert>
      ) : null}

      <div className="gx-cols">
        <Card>
          <h2 className="gx-form-section__title">Trošak po kategoriji</h2>
          <DescriptionList
            items={money.by_category.map((category) => ({
              term: category.category_name,
              value: (
                <Inline gap="var(--space-2)">
                  <span>{category.posted}</span>
                  {category.budget === null ? (
                    <Chip tone="hollow">bez budžeta</Chip>
                  ) : (
                    <span className="gx-page-sub">/ {category.budget}</span>
                  )}
                </Inline>
              ),
            }))}
          />
          <div className="gx-inline-flex gx-mt-2">
            <Button variant="quiet" onClick={() => onOpenTab("costs")}>
              Svi troškovi
            </Button>
            <Button variant="quiet" onClick={() => onOpenTab("budget")}>
              Budžet
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="gx-form-section__title">Napredak</h2>
          <p className="gx-page-sub">
            {phases === null || phases.progress_pct === null
              ? "Bez faza nema procenta."
              : `${phases.progress_pct.toFixed(1)} % (${phases.progress_source === "BOQ" ? "iz predmjera" : "ručno po fazama"})`}
          </p>
          <p className="gx-page-sub">
            Marža i EAC se računaju iz knjiženog troška; procenat služi da se vidi koliko je posla
            ostalo, ne da se njime množi novac.
          </p>
        </Card>
      </div>

      <Card>
        <h2 className="gx-form-section__title">Faze i procenti</h2>
        <ProjectProgress projectId={projectId} canManage={canManage} onChanged={load} />
      </Card>

      {canManage ? (
        <Card>
          <h2 className="gx-form-section__title">Zatvaranje projekta</h2>
          <p className="gx-page-sub">
            Zatvaranje pravi zamrznuti snimak i blokira nova knjiženja. Ponovno otvaranje traži
            razlog i ostaje u auditu — snimak se ne briše.
          </p>
          <div className="gx-inline-flex gx-mt-2">
            <Button variant="secondary" disabled={busy} onClick={() => void openChecklist()}>
              Provjeri kontrolnu listu
            </Button>
          </div>
        </Card>
      ) : null}

      {closing && checklist ? (
        <Dialog
          title="Kontrolna lista prije zatvaranja"
          hint="Zatvaranje je moguće kad su sve stavke zelene. Stavka „troškovi bez cijene“ može se prihvatiti uz razlog."
          returnFocusTo={null}
          onClose={() => {
            setClosing(false);
            setPendingReason("");
            setConfirmPending(false);
          }}
        >
          <div className="gx-stack">
            <ul className="gx-stack gx-stack--2">
              {checklist.items.map((item) => (
                <li key={item.key} className="gx-inline-flex">
                  <Chip tone={item.ok ? "hollow" : "hot"}>{item.ok ? "spremno" : `${item.count} otvoreno`}</Chip>
                  <span>{item.label}</span>
                  {item.acceptable && !item.ok ? <span className="gx-page-sub">može se prihvatiti</span> : null}
                </li>
              ))}
            </ul>
            {checklist.complete ? null : (
              <Alert tone="warning">
                Blokade: {checklist.blockers.join("; ")}.
              </Alert>
            )}

            {!checklist.complete &&
            checklist.items.some((item) => item.key === "PENDING_COSTS" && !item.ok) ? (
              <div className="gx-stack">
                <Checkbox
                  label="Prihvatam preostale troškove bez cijene"
                  checked={confirmPending}
                  onChange={(event) => setConfirmPending(event.target.checked)}
                />
                <Textarea
                  label="Razlog prihvatanja"
                  hint="Najmanje 10, najviše 500 znakova. Razlog se upisuje uz snimak zatvaranja."
                  rows={3}
                  minLength={10}
                  maxLength={500}
                  value={pendingReason}
                  onChange={(event) => setPendingReason(event.target.value)}
                />
              </div>
            ) : null}

            <div className="gx-inline-flex gx-mt-2">
              <Button variant="quiet" onClick={() => setClosing(false)}>
                Odustani
              </Button>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  (!checklist.complete && !(confirmPending && pendingReason.trim().length >= 10))
                }
                onClick={() => void submitClose()}
              >
                Zatvori projekat
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

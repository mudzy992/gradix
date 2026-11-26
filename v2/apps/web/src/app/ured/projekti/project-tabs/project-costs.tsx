"use client";

/**
 * Troškovi projekta (tab 2): jedinstveni ledger, sa stornom umjesto brisanja.
 *
 * Knjiženje je AUTOMATSKO — na promjenu statusa izvornog zapisa (radni dan, rad mašine, gorivo,
 * prevoz, servis). Zato na ovom ekranu nema dugmeta „knjiži“: postoje samo ručni unos (kad izvor
 * ne postoji, npr. gotovinski račun) i storno (kad je iznos pogrešan).
 *
 * `PENDING` red nema iznos — polje je prazno, ne nula. U zbroj ulazi samo `POSTED`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import Link from "next/link";
import { formatDate } from "@/format";
import {
  Alert, Button, Chip, DataTable, Dialog, EmptyState, FilterBar, Select, Skeleton, Stat, Textarea,
} from "@/components/ui/index";

import type { CostEntryRow as CostEntry } from "@/server/cost-entry-types";
import { ManualCostForm } from "./manual-cost-form";
import type { PendingManualCostsResponse } from "@gradix/contracts";
import type { z } from "zod";
import type { CategoryRow } from "@/server/project-budget-types";

type CostTotals = {
  posted: string;
  currency_code: string;
  pending_count: number;
  pending_quantity_by_unit: Array<{ unit: string; quantity: string }>;
};

const STATUS_LABEL: Record<CostEntry["status"], string> = {
  POSTED: "Knjiženo",
  PENDING: "Bez cijene",
  REVERSED: "Stornirano",
};

export function ProjectCosts({
  projectId,
  initialPending = false,
  canManage,
  canBook = canManage,
  canApproveManual = false,
}: {
  projectId: string;
  initialPending?: boolean;
  canManage: boolean;
  /** `projects.costs.book` — ručni unos i storno. ACCOUNTANT vidi, ali ne knjiži. */
  canBook?: boolean;
  canApproveManual?: boolean;
}) {
  const [entries, setEntries] = useState<CostEntry[] | null>(null);
  const [totals, setTotals] = useState<CostTotals | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [statusFilter, setStatusFilter] = useState(initialPending ? "PENDING" : "");
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<z.infer<typeof PendingManualCostsResponse>["requests"]>([]);
  const [pendingError, setPendingError] = useState<string|null>(null);
  const [reversing, setReversing] = useState<CostEntry | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const query = new URLSearchParams({ projectId });
    if (statusFilter) query.set("status", statusFilter);
    const [listResult, categoryResult, pendingResult] = await Promise.all([
      apiCall<{ entries: CostEntry[]; totals: CostTotals }>(`/api/costs?${query.toString()}`),
      apiCall<{ categories: CategoryRow[] }>("/api/cost-categories"),
      apiCall<z.infer<typeof PendingManualCostsResponse>>(`/api/costs/manual?projectId=${encodeURIComponent(projectId)}`),
    ]);
    if (!listResult.ok) {
      setError(listResult.message);
      setEntries(null);
      return;
    }
    if(pendingResult.ok) { setPendingRequests(pendingResult.data.requests); setPendingError(null); }
    else { setPendingError(pendingResult.message); }
    setEntries(listResult.data.entries);
    setTotals(listResult.data.totals);
    if (categoryResult.ok) {
      setCategories(categoryResult.data.categories.filter((category) => category.is_active));
    }
  }, [projectId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingHint = useMemo(() => {
    if (!totals || totals.pending_quantity_by_unit.length === 0) return undefined;
    return totals.pending_quantity_by_unit
      .map((row) => `${row.quantity} ${row.unit}`)
      .join(" · ");
  }, [totals]);

  async function approveManual(id:string) {
    setBusy(true); setError(null);
    const result=await apiCall(`/api/costs/manual/${encodeURIComponent(id)}/approve`,jsonBody({}));
    setBusy(false);
    if(!result.ok) {setError(result.message);return;}
    setMessage("Ručni trošak je odobren i knjižen."); await load();
  }

  async function submitReverse(event: React.FormEvent) {
    event.preventDefault();
    if (!reversing || reason.trim().length < 10) return;
    setBusy(true);
    setError(null);
    const result = await apiCall<{ id?: string }>(`/api/costs/${reversing.id}/reverse`, {
      ...jsonBody({ reason: reason.trim(), replacement: null }),
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setReversing(null);
    setReason("");
    setMessage("Trošak je storniran: original ostaje sačuvan kao „stornirano“.");
    await load();
  }

  if (error && entries === null) return <Alert tone="error">{error}</Alert>;
  if (entries === null) return <Skeleton rows={5} />;

  return (
    <div className="gx-stack">
      {message ? <Alert tone="success" role="status">{message}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="gx-cols">
        <Stat
          label="Knjiženo (POSTED)"
          value={totals ? totals.posted : "—"}
          hint={totals ? `Valuta: ${totals.currency_code}` : undefined}
        />
        <Stat
          label="Bez cijene (PENDING)"
          value={totals ? String(totals.pending_count) : "—"}
          hint={
            totals && totals.pending_count > 0
              ? `Ne ulazi u zbroj.${pendingHint ? ` Količine: ${pendingHint}.` : ""}`
              : "Svaki zapis ima iznos."
          }
        />
      </div>

      <section aria-label="Ručni troškovi na čekanju">
        <h2>Ručni troškovi na čekanju odobrenja</h2>
        {pendingError ? <Alert tone="error" role="alert">{pendingError}</Alert> : null}
        <DataTable caption="Zahtjevi ručnog troška na čekanju" rows={pendingRequests} rowKey={r=>r.id} emptyText="Nema zahtjeva na čekanju." columns={[
          {key:"date",header:"Datum",cell:r=>formatDate(r.occurred_on)}, {key:"category",header:"Kategorija",cell:r=>r.category_name},
          {key:"amount",header:"Iznos (feninga)",cell:r=>`${r.amount_cents} ${r.currency_code}`}, {key:"note",header:"Napomena",cell:r=>r.note ?? "—"},
          {key:"status",header:"Status",cell:()=>"Čeka odobrenje"},
          {key:"actions",header:"Radnja",cell:r=>canApproveManual ? <Button disabled={busy} onClick={()=>void approveManual(r.id)}>Odobri ručni trošak</Button> : "—"},
        ]} />
      </section>

      <FilterBar>
        <Select
          label="Status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">Svi</option>
          <option value="POSTED">Knjiženo</option>
          <option value="PENDING">Bez cijene</option>
          <option value="REVERSED">Stornirano</option>
        </Select>
      </FilterBar>

      {canBook ? (
        <div className="gx-inline-flex">
          <Button
            variant="primary"
            onClick={() => setManual(true)}
          >
            + Ručni trošak
          </Button>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          title="Nema troškova"
          description="Trošak se knjiži sam kad radni dan, rad mašine, gorivo ili servis dobiju cijenu. Ručni unos je za ono što nema izvor."
        />
      ) : (
        <DataTable
          caption="Troškovi projekta"
          rows={entries}
          rowKey={(entry) => entry.id}
          emptyText="Nema troškova."
          columns={[
            {
              key: "date",
              header: "Datum",
              cell: (entry) => formatDate(entry.occurred_on),
              sortValue: (entry) => entry.occurred_on,
            },
            {
              key: "category",
              header: "Kategorija",
              cell: (entry) => entry.category_name,
            },
            {
              key: "source",
              header: "Izvor",
              cell: (entry) => (
                <span className="gx-stack gx-stack--2">
                  {/*
                   * Drill-down (spec 06 §4): trošak → izvorni zapis. Izvor se NIKAD ne prikazuje
                   * bez puta do njega — inače se iznos ne može provjeriti, a to je jedina svrha
                   * knjige troškova na terenu.
                   */}
                  {entry.source_href ? (
                    <Link href={entry.source_href}>{sourceLabel(entry)}</Link>
                  ) : (
                    <span>{sourceLabel(entry)}</span>
                  )}
                  {entry.machine_code ? <Chip tone="hollow">{entry.machine_code}</Chip> : null}
                  {entry.phase_name ? <span className="gx-page-sub">{entry.phase_name}</span> : null}
                </span>
              ),
            },
            {
              key: "amount",
              header: "Iznos",
              numeric: true,
              cell: (entry) =>
                entry.amount === null ? (
                  <Chip tone="hollow">bez cijene</Chip>
                ) : (
                  <span>{entry.amount}</span>
                ),
            },
            {
              key: "status",
              header: "Status",
              cell: (entry) => (
                <Chip tone={entry.status === "POSTED" ? "hollow" : "hot"}>{STATUS_LABEL[entry.status]}</Chip>
              ),
            },
            {
              key: "note",
              header: "Napomena",
              cell: (entry) => entry.note ?? "—",
            },
          ]}
          rowActionLabel={(entry) => `Više radnji za trošak ${entry.category_name} ${entry.amount ?? ""}`}
          actions={(entry) =>
            canBook && entry.status !== "REVERSED"
              ? [
                  {
                    key: "reverse",
                    label: "Storno (ispravka iznosa)",
                    danger: true,
                    onSelect: () => {
                      setError(null);
                      setReversing(entry);
                      setReason("");
                    },
                  },
                ]
              : []
          }
        />
      )}

      {manual ? <ManualCostForm projectId={projectId} categories={categories} currency={totals?.currency_code ?? "BAM"} onClose={()=>setManual(false)} onSaved={async text=>{setManual(false);setMessage(text);await load();}} /> : null}

      {reversing ? (
        <Dialog
          title="Storno troška"
          hint="Original ostaje u knjizi kao storniran; novi red se ne knjiži automatski. Razlog je obavezan jer objašnjava razliku."
          returnFocusTo={null}
          onClose={() => {
            setReversing(null);
            setReason("");
          }}
        >
          <form className="gx-stack" onSubmit={submitReverse}>
            <Textarea
              label="Razlog storna"
              rows={4}
              minLength={10}
              maxLength={1000}
              required
              hint="Najmanje 10 znakova. Razlog se ne može mijenjati."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="gx-inline-flex gx-mt-2">
              <Button variant="quiet" onClick={() => setReversing(null)}>
                Otkaži
              </Button>
              <Button type="submit" variant="danger" disabled={busy || reason.trim().length < 10}>
                Storniraj
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

const SOURCE_LABEL: Record<CostEntry["source_type"], string> = {
  WORKDAY: "Radni dan",
  MACHINE_WORK_LOG: "Rad mašine",
  FUEL_ENTRY: "Gorivo",
  HAUL: "Prevoz",
  SERVICE_ORDER: "Servis",
  PURCHASE: "Nabavka",
  SUBCONTRACTOR: "Podizvođač",
  MANUAL: "Ručni unos",
};

function sourceLabel(entry: CostEntry): string {
  if (entry.reverses_id) return `Storno · ${SOURCE_LABEL[entry.source_type]}`;
  return SOURCE_LABEL[entry.source_type];
}

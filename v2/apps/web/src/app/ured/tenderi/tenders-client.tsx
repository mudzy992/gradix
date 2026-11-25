"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Checkbox, Chip, DataTable, FilterBar, Inline, Mono, Select, Stack,
} from "@/components/ui/index";
import type { TenderRow } from "@gradix/contracts";
import {
  deadlineText,
  deadlineTone,
  formatDate,
  formatTenderValue,
  STATUS_LABEL,
  STATUS_OPTIONS,
  TERMINAL_STATUSES,
} from "./tenders-shared";
import { EMPTY_TENDER_FORM, TenderFormDialog, type TenderFormState } from "./tender-form-dialog";

type Caps = {
  canManage: boolean;
  canConvert: boolean;
  canPrice: boolean;
  canApprovePrice: boolean;
  canOutcome: boolean;
};
type PartnerOpt = { id: string; code: string; name: string; kind: string };

/**
 * Lista tendera: tabela + kanban po statusu.
 *
 * Zašto oba: tabela odgovara na „šta mi ističe“, kanban na „gdje sve stoji“. Filtri su
 * zajednički, pa prebacivanje ne gubi kontekst. Hitnost roka je kolona, ne boja sama —
 * boja bez teksta ne prolazi `axe-core` i ne čita se na suncu.
 */
export function TendersClient({
  initialTenders,
  caps,
}: {
  initialTenders: TenderRow[];
  caps: Caps;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("");
  const [view, setView] = useState<"table" | "board">("table");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [partners, setPartners] = useState<PartnerOpt[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<TenderFormState>({ ...EMPTY_TENDER_FORM });

  const visible = useMemo(
    () =>
      initialTenders.filter((row) => {
        if (statusFilter && row.status !== statusFilter) return false;
        if (urgentOnly) {
          if (row.daysToDeadline === null) return false;
          if (row.daysToDeadline < 0 || row.daysToDeadline > 14) return false;
          if (TERMINAL_STATUSES.includes(row.status)) return false;
        }
        return true;
      }),
    [initialTenders, statusFilter, urgentOnly],
  );

  const openCreate = async () => {
    if (!partners) {
      const res = await apiCall<{ partners: PartnerOpt[] }>("/api/partners");
      if (res.ok) {
        const list = res.data.partners;
        setPartners([
          ...list.filter((p) => p.kind === "CLIENT"),
          ...list.filter((p) => p.kind !== "CLIENT"),
        ]);
      }
    }
    setForm({ ...EMPTY_TENDER_FORM });
    setCopyFrom("");
    setCreating(true);
  };

  const save = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall<{ outcome: string; id?: string }>("/api/tenders", jsonBody({
      title: form.title.trim(),
      partnerId: form.partnerId,
      submittedValueAmount: form.submittedValueAmount.trim() || "0.00",
      currencyCode: form.currencyCode,
      note: form.note.trim() || null,
      estimatedValueAmount: form.estimatedValueAmount.trim() || null,
      externalRef: form.externalRef.trim() || null,
      source: form.source || null,
      portalName: form.portalName.trim() || null,
      deadlineAt: form.deadlineAt ? new Date(form.deadlineAt).toISOString() : null,
      questionsDeadlineAt: form.questionsDeadlineAt
        ? new Date(form.questionsDeadlineAt).toISOString()
        : null,
      siteVisitAt: form.siteVisitAt ? new Date(form.siteVisitAt).toISOString() : null,
    }));
    if (!result.ok) {
      setBusy(false);
      setNotice({ tone: "error", text: result.message });
      return;
    }
    /* Kopiranje iz sličnog ide odmah poslije unosa: dva klika za isti posao bi značila da
       korisnik zaboravi drugi. */
    if (copyFrom && result.data.id) {
      const copied = await apiCall(`/api/tenders/${result.data.id}/copy`, jsonBody({
        copyFromTenderId: copyFrom,
      }));
      if (!copied.ok) {
        setBusy(false);
        setNotice({ tone: "error", text: `Tender je kreiran, ali kopiranje nije uspjelo: ${copied.message}` });
        router.refresh();
        return;
      }
    }
    setBusy(false);
    setCreating(false);
    setNotice({ tone: "success", text: "Tender je kreiran." });
    router.refresh();
  };

  const convert = async (row: TenderRow) => {
    setBusy(true);
    const result = await apiCall<{ outcome: string; projectId?: string }>(
      `/api/tenders/${row.id}/convert`,
      { method: "POST" },
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({ tone: "success", text: "Tender je pretvoren u projekat." });
    router.refresh();
  };

  return (
    <Stack>
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}

      <FilterBar>
        <Select
          label="Status"
          id="tnd-st"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Svi statusi</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>{STATUS_LABEL[status]}</option>
          ))}
        </Select>
        <Select
          label="Prikaz"
          id="tnd-view"
          value={view}
          onChange={(e) => setView(e.target.value === "board" ? "board" : "table")}
        >
          <option value="table">Tabela</option>
          <option value="board">Kanban</option>
        </Select>
        <Checkbox
          label="Samo hitni (14 dana)"
          id="tnd-urgent"
          checked={urgentOnly}
          onChange={(e) => setUrgentOnly(e.target.checked)}
        />
        {caps.canManage ? (
          <Button variant="primary" onClick={() => void openCreate()}>+ Novi tender</Button>
        ) : null}
      </FilterBar>

      {visible.length === 0 ? (
        <p className="gx-page-sub">Nema tendera za izabrane filtere.</p>
      ) : view === "table" ? (
        <DataTable
          caption="Tenderi"
          rowKey={(row) => row.id}
          rows={visible}
          emptyText="Nema tendera."
          columns={[
            {
              key: "title",
              header: "Predmet",
              cell: (row) => (
                <Link className="gx-link" href={`/ured/tenderi/${row.id}`}>{row.title}</Link>
              ),
            },
            { key: "client", header: "Naručilac", cell: (row) => row.partnerName },
            {
              key: "deadline",
              header: "Rok dostave",
              cell: (row) => (
                <Inline>
                  <span>{formatDate(row.deadlineAt)}</span>
                  {row.daysToDeadline !== null ? (
                    <Chip tone={deadlineTone(row.daysToDeadline) === "danger" ? "hot" : "hollow"}>
                      {deadlineText(row.daysToDeadline, row.deadlineAt)}
                    </Chip>
                  ) : null}
                </Inline>
              ),
            },
            {
              key: "value",
              header: "Vrijednost",
              numeric: true,
              cell: (row) => (
                <Mono>{formatTenderValue(row.submittedValueAmount, row.currencyCode)}</Mono>
              ),
            },
            ...(caps.canPrice
              ? [{
                  key: "margin",
                  header: "Marža",
                  numeric: true,
                  cell: (row: TenderRow) => (row.markupPct ? <Mono>{row.markupPct} %</Mono> : "—"),
                }]
              : []),
            {
              key: "st",
              header: "Status",
              cell: (row) => (
                <Chip tone={row.status === "WON" ? "full" : "hollow"}>{STATUS_LABEL[row.status]}</Chip>
              ),
            },
          ]}
          actions={(row) => [
            { key: "open", label: "Otvori", onSelect: () => router.push(`/ured/tenderi/${row.id}`) },
            ...(caps.canConvert && row.status === "WON" && !row.convertedProjectId
              ? [{ key: "conv", label: "Pretvori u projekat", onSelect: () => void convert(row) }]
              : []),
          ]}
        />
      ) : (
        <div className="gx-cols">
          {STATUS_OPTIONS.filter((status) => !statusFilter || status === statusFilter).map((status) => {
            const rows = visible.filter((row) => row.status === status);
            return (
              <section key={status} className="gx-card" aria-label={STATUS_LABEL[status]}>
                <h2 className="gx-section-title">
                  {STATUS_LABEL[status]} <span className="gx-page-sub">({rows.length})</span>
                </h2>
                {rows.length === 0 ? (
                  <p className="gx-page-sub">—</p>
                ) : (
                  <ul className="gx-stack">
                    {rows.map((row) => (
                      <li key={row.id}>
                        <Link className="gx-link" href={`/ured/tenderi/${row.id}`}>{row.title}</Link>
                        <div className="gx-page-sub">
                          {row.partnerName} · {formatDate(row.deadlineAt)}
                          {row.daysToDeadline !== null ? ` · ${deadlineText(row.daysToDeadline, row.deadlineAt)}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {creating ? (
        <TenderFormDialog
          form={form}
          onChange={setForm}
          onClose={() => setCreating(false)}
          onSave={() => void save()}
          partners={partners}
          copyFrom={copyFrom}
          onCopyFromChange={setCopyFrom}
          tenders={initialTenders}
          busy={busy}
        />
      ) : null}
    </Stack>
  );
}

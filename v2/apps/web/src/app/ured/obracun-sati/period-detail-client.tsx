"use client";

/**
 * Detalj perioda obračuna (F6, spec 07 §4).
 *
 * Odluke koje ekran nosi:
 *   1. **Linija bez iznosa nije nula.** `RATE_MISSING`/`PARAMETER_MISSING` linije prikazuju
 *      crticu i razlog, a zbir postaje „—“. Nula bi izgledala kao obračunata nula i tiho bi
 *      prošla u isplatu.
 *   2. **Dugmad prate stanje, ne želju.** Izračun je moguć dok period nije zaključan; odobrenje
 *      samo iz `CALCULATED`; zaključavanje samo iz `APPROVED`. Ekran ne nudi radnju koja će pasti.
 *   3. **Raspis je klik, ne skriveni podatak.** Svaka linija ima izvore (§1.4/16): dan, sate i
 *      parametre sa datumom važenja — to je odgovor na „odakle ovaj iznos“.
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/api-client";
import {
  groupByWorker,
  hours,
  money,
  statusTone,
  STATUS_LABEL,
  type LineSource,
  type LinesPayload,
  type PayrollLine,
  type Period,
  type PeriodStatus,
} from "./payroll-view-model";
import {
  Alert, Button, DataTable, Dialog, EmptyState, Inline, Select, Skeleton, Stack, StatusDot, Tabs,
} from "@/components/ui/index";

export function PeriodDetailClient({
  period,
  initialLines,
  lineError,
  caps,
}: {
  period: Period;
  initialLines: LinesPayload | null;
  lineError: string | null;
  caps: { canCalculate: boolean; canApprove: boolean; canExport: boolean };
}) {
  const router = useRouter();
  const [lines, setLines] = useState(initialLines);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [tab, setTab] = useState("workers");
  const [componentFilter, setComponentFilter] = useState("");
  const [sources, setSources] = useState<{ line: PayrollLine; sources: LineSource[] } | null>(null);
  const [sourcesBusy, setSourcesBusy] = useState(false);

  const reload = useCallback(async () => {
    const result = await apiCall<LinesPayload>(`/api/pay-periods/${period.id}/lines`);
    if (result.ok) setLines(result.data);
    router.refresh();
  }, [period.id, router]);

  const run = async (action: "calculate" | "approve" | "lock") => {
    setBusy(action);
    setNotice(null);
    const result = await apiCall<{ status: PeriodStatus }>(
      `/api/pay-periods/${period.id}/${action}`,
      { method: "POST" },
    );
    setBusy(null);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({
      tone: "success",
      text:
        action === "calculate"
          ? "Obračun je izračunat u novoj reviziji."
          : action === "approve"
            ? "Period je odobren."
            : "Period je zaključan. Ispravke sada idu kroz korekcije.",
    });
    await reload();
  };

  const openSources = async (line: PayrollLine) => {
    setSourcesBusy(true);
    const result = await apiCall<{ line: PayrollLine; sources: LineSource[] }>(
      `/api/payroll/lines/${line.id}/sources`,
    );
    setSourcesBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setSources({ line: result.data.line, sources: result.data.sources });
  };

  const exportFile = async (format: "xlsx" | "csv") => {
    setBusy(`export-${format}`);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/pay-periods/${period.id}/export?format=${format}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setNotice({ tone: "error", text: body?.error?.message ?? "Izvoz nije uspio." });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `obracun-${period.year}-${String(period.month).padStart(2, "0")}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  };

  const grouped = useMemo(() => groupByWorker(lines?.lines ?? []), [lines]);
  const componentCodes = useMemo(() => {
    const codes = new Map<string, string>();
    for (const row of lines?.lines ?? []) codes.set(row.component_code, row.component_name);
    return [...codes.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lines]);

  const visible = useMemo(() => {
    if (!componentFilter) return grouped;
    return grouped.filter((row) => row.components.has(componentFilter));
  }, [grouped, componentFilter]);

  const canCalculate = caps.canCalculate && period.status !== "LOCKED";
  const canApprove = caps.canApprove && period.status === "CALCULATED" && period.blockers.length === 0;
  const canLock = caps.canApprove && period.status === "APPROVED";

  return (
    <Stack gap="var(--space-5)">
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}

      <Inline>
        <StatusDot tone={statusTone(period.status)} label={STATUS_LABEL[period.status]} />
        {period.revision ? <span className="gx-page-sub">Revizija {period.revision}</span> : null}
        <span className="gx-page-sub">Radnika: {period.worker_count}</span>
        <span className="gx-page-sub">
          Bruto osnova: {period.gross_total === null ? "—" : period.gross_total}
        </span>
      </Inline>

      {/* Blokade: IME razloga i broj, prije klika — ne poslije odbijanja. */}
      {period.blockers.length > 0 ? (
        <Alert tone="warning">
          Period nije spreman za odobrenje:
          <ul>
            {period.blockers.map((blocker) => (
              <li key={blocker.code}>{blocker.message} ({blocker.count})</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Inline>
        <Button
          variant="primary"
          onClick={() => void run("calculate")}
          disabled={!canCalculate || busy !== null}
        >
          {busy === "calculate" ? "Računam…" : "Izračunaj"}
        </Button>
        <Button
          onClick={() => void run("approve")}
          disabled={!canApprove || busy !== null}
          title={
            period.status !== "CALCULATED"
              ? "Odobrenje je moguće samo za izračunat period."
              : period.blockers.length > 0
                ? "Period ima blokade — riješite ih pa odobrite."
                : undefined
          }
        >
          {busy === "approve" ? "Odobravam…" : "Odobri"}
        </Button>
        <Button
          onClick={() => void run("lock")}
          disabled={!canLock || busy !== null}
          title={period.status !== "APPROVED" ? "Zaključava se samo odobren period." : undefined}
        >
          {busy === "lock" ? "Zaključavam…" : "Zaključaj"}
        </Button>
        {caps.canExport ? (
          <>
            <Button
              variant="quiet"
              onClick={() => void exportFile("xlsx")}
              disabled={busy !== null}
            >
              {busy === "export-xlsx" ? "Izvozim…" : "XLSX"}
            </Button>
            <Button
              variant="quiet"
              onClick={() => void exportFile("csv")}
              disabled={busy !== null}
            >
              {busy === "export-csv" ? "Izvozim…" : "CSV"}
            </Button>
          </>
        ) : null}
      </Inline>

      {lineError ? <Alert tone="error">{lineError}</Alert> : null}

      {lines === null ? null : !busy && lines.lines.length === 0 ? (
        <EmptyState
          title="Nema obračuna"
          description="Period još nije izračunat — pokrenite „Izračunaj“ da se sati podijele po vrstama i izračunaju iznosi."
        />
      ) : (
        <>
          <Tabs label="Linije obračuna" active={tab} onChange={setTab} tabs={[{key:"workers",label:"Po radnicima"},{key:"lines",label:"Pojedinačne linije"}]} />
          {tab === "workers" ? <>
          <Inline>
            <Select
              label="Komponenta"
              value={componentFilter}
              onChange={(event) => setComponentFilter(event.target.value)}
            >
              <option value="">Sve komponente</option>
              {componentCodes.map(([code, name]) => (
                <option key={code} value={code}>{code} — {name}</option>
              ))}
            </Select>
            <span className="gx-page-sub">
              Zarade: {money(lines?.totals.earnings_cents ?? null)} · Odbici:{" "}
              {money(lines?.totals.deductions_cents ?? null)}
              {lines && lines.totals.missing_workers > 0
                ? ` · ${lines.totals.missing_workers} radnika bez iznosa`
                : ""}
            </span>
          </Inline>

          <DataTable
            caption="Obračun po radnicima"
            rows={visible}
            rowKey={(row) => row.workerId}
            columns={[
              { key: "worker", header: "Radnik", cell: (row) => row.workerName },
              {
                key: "components",
                header: "Komponente",
                cell: (row) => (
                  <Stack gap="2px">
                    {[...row.components.values()].map((component) => (
                      <span key={component.code} className="gx-page-sub">
                        <strong>{component.code}</strong>{" "}
                        {component.hours > 0 ? `${hours(component.hours)} h` : null}
                        {component.days > 0 ? `${component.days} d` : null}{" "}
                        {component.status === "OK" ? money(component.amount) : `— (${component.status})`}
                      </span>
                    ))}
                  </Stack>
                ),
              },
              { key: "earnings", header: "Zarade", numeric: true, cell: (row) => money(row.earnings) },
              { key: "deductions", header: "Odbici", numeric: true, cell: (row) => money(row.deductions) },
            ]}
            actions={(row) => {
              /* Komponente su sažete po radniku, pa raspis ide na PRVU liniju radnika; u
                 detaljnom pregledu ispod svaka linija ima svoj raspis. */
              const first = lines?.lines.find((line) => line.worker_id === row.workerId);
              return first
                ? [{ key: "sources", label: "Raspis", onSelect: () => void openSources(first) }]
                : [];
            }}
          />

          </> : null}
          {tab === "lines" ? <section>
            <p className="gx-page-sub">Linije pojedinačno ({lines?.lines.length ?? 0}) — klik na „Izvori“ otvara raspis</p>
            <DataTable
              caption="Linije obračuna"
              rows={lines?.lines ?? []}
              rowKey={(row) => row.id}
              columns={[
                { key: "worker", header: "Radnik", cell: (row) => row.worker_name },
                { key: "component", header: "Komponenta", cell: (row) => `${row.component_code} — ${row.component_name}` },
                { key: "hours", header: "Sati", numeric: true, cell: (row) => hours(row.hours) },
                { key: "days", header: "Dani", numeric: true, cell: (row) => hours(row.days) },
                {
                  key: "rate",
                  header: "Satnica",
                  numeric: true,
                  cell: (row) => money(row.rate_cents),
                },
                {
                  key: "amount",
                  header: "Iznos",
                  numeric: true,
                  cell: (row) =>
                    row.status === "OK" ? money(row.amount_cents) : <StatusDot tone="danger" label={row.status} />,
                },
                { key: "note", header: "Napomena", cell: (row) => row.calc_note ?? "—" },
              ]}
              actions={(row) => [
                { key: "sources", label: "Izvori", onSelect: () => void openSources(row) },
              ]}
            />
          </section> : null}
        </>
      )}

      {sources !== null || sourcesBusy ? (
        <Dialog
          onClose={() => { setSources(null); setSourcesBusy(false); }}
          title={sources ? `Raspis: ${sources.line.component_name}` : "Raspis"}
          wide
        >
        {sourcesBusy ? <Skeleton rows={4} /> : null}
        {sources ? (
          <Stack>
            <p className="gx-page-sub">
              {sources.line.worker_name} · {hours(sources.line.hours)} h ·{" "}
              {sources.line.status === "OK" ? money(sources.line.amount_cents) : sources.line.status}
            </p>
            <DataTable
              caption="Izvori linije"
              rows={sources.sources}
              rowKey={(row) => row.id}
              columns={[
                { key: "date", header: "Dan", cell: (row) => row.work_date ?? "—" },
                { key: "type", header: "Izvor", cell: (row) => row.source_type },
                { key: "hours", header: "Sati", numeric: true, cell: (row) => hours(row.hours) },
                { key: "days", header: "Dani", numeric: true, cell: (row) => hours(row.days) },
                { key: "amount", header: "Iznos", numeric: true, cell: (row) => money(row.amount_cents) },
                {
                  key: "params",
                  header: "Parametri (sa datumom važenja)",
                  cell: (row) =>
                    Object.keys(row.applied_parameters).length === 0
                      ? "—"
                      : JSON.stringify(row.applied_parameters),
                },
              ]}
            />
            <p className="gx-page-sub">
              Zbir sati raspisa = {hours(sources.sources.reduce((sum, row) => sum + row.hours, 0))} h.
              Svaki sat ima tačno jedan izvor.
            </p>
          </Stack>
        ) : null}
        </Dialog>
      ) : null}
    </Stack>
  );
}

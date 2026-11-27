"use client";

/**
 * Lista mjesečnih perioda obračuna (F6, spec 07 §4).
 *
 * Tri odluke ekrana:
 *   1. **Period se ne pravi sam.** Računovodstvo bira mjesec; dugme postoji samo kad firma
 *      još nema period za taj mjesec (`can_create`). Automatsko otvaranje na svaki prelaz
 *      mjeseca bi pravilo prazne periode koje niko nije pogledao.
 *   2. **„Spremnost“ je vidljiva PRIJE klika.** Blokade (`blockers`) se ispisuju uz period,
 *      pa se ne saznaje tek na odbijanju odobrenja (§1.8/30).
 *   3. **Bruto je `null`, ne nula** dok period nije izračunat: djelimičan ili nepostojeći zbir
 *      prikazan kao 0,00 izgleda kao stvarna nula i to je greška koja se ne vidi.
 */
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, DataTable, EmptyState, Inline, SelectField as Select, Stack, StatusDot,
} from "@/components/ui/index";

type PeriodStatus = "OPEN" | "CALCULATED" | "APPROVED" | "LOCKED";

type Blocker = { code: string; count: number; message: string };

export type PeriodRow = {
  id: string;
  year: number;
  month: number;
  status: PeriodStatus;
  calculated_at: string | null;
  approved_at: string | null;
  locked_at: string | null;
  worker_count: number;
  gross_total: string | null;
  revision: number | null;
  blockers: Blocker[];
};

const MONTHS = [
  "januar", "februar", "mart", "april", "maj", "jun",
  "jul", "avgust", "septembar", "oktobar", "novembar", "decembar",
] as const;

import { PAYROLL_STATUS_NAMES as STATUS_LABEL } from "@/lib/labels";

/** Status perioda je chip sa tekstom, nikad samo boja. */
export function statusTone(status: PeriodStatus): "ok" | "warn" | "danger" | "muted" {
  if (status === "LOCKED" || status === "APPROVED") return "ok";
  if (status === "CALCULATED") return "warn";
  return "muted";
}

/**
 * Jedna rečenica o spremnosti. Odsustvo blokada NIJE isto što i „spremno za odobrenje“:
 * `OPEN` period bez ijedne linije nema šta da odobri, pa se to kaže riječima.
 */
export function readinessText(period: PeriodRow): string {
  if (period.status === "LOCKED") return "Zaključan — ispravke idu kroz korekcije.";
  if (period.status === "APPROVED") return "Odobren, čeka zaključavanje.";
  if (period.blockers.length > 0) {
    return period.blockers.map((blocker) => `${blocker.message} (${blocker.count})`).join(" ");
  }
  if (period.status === "OPEN") return "Nije izračunat.";
  return period.revision ? `Revizija ${period.revision}, spremno za odobrenje.` : "Spremno za odobrenje.";
}

export function PeriodsClient({
  initialPeriods,
  canCreate,
  year,
}: {
  initialPeriods: PeriodRow[];
  canCreate: boolean;
  year: number;
}) {
  const router = useRouter();
  const [periods, setPeriods] = useState(initialPeriods);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [yearFilter, setYearFilter] = useState(String(year));

  const years = useMemo(() => {
    const set = new Set<number>(periods.map((period) => period.year));
    set.add(year);
    return [...set].sort((a, b) => b - a);
  }, [periods, year]);

  const visible = useMemo(
    () => periods.filter((period) => String(period.year) === yearFilter),
    [periods, yearFilter],
  );

  const load = useCallback(async () => {
    const result = await apiCall<{ periods: PeriodRow[] }>("/api/pay-periods");
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setPeriods(result.data.periods);
  }, []);

  const openPeriod = async () => {
    setBusy(true);
    setNotice(null);
    const now = new Date();
    const result = await apiCall<{ id: string }>(
      "/api/pay-periods",
      jsonBody({ year: Number(yearFilter), month: now.getMonth() + 1 }),
    );
    setBusy(false);
    if (!result.ok) {
      /* Period za tekući mjesec često već postoji; tada poruka mora reći ŠTA je, a ne samo
         „greška“ — inače računovođa klikne opet i opet. */
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({ tone: "success", text: "Period je otvoren." });
    await load();
    router.refresh();
  };

  return (
    <Stack gap="var(--space-5)">
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}

      <Inline>
        <Select
          label="Godina"
          value={yearFilter}
          onChange={(event) => setYearFilter(event.target.value)}
        >
          {years.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </Select>
        {canCreate ? (
          <Button onClick={() => void openPeriod()} disabled={busy}>
            {busy ? "Otvaram…" : `Otvori period za ${MONTHS[new Date().getMonth()]}`}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => { void load(); router.refresh(); }}
          disabled={busy}
        >
          Osvježi
        </Button>
      </Inline>

      <DataTable
        caption="Periodi obračuna"
        rows={visible}
        rowKey={(row) => row.id}
        columns={[
          {
            key: "month",
            header: "Mjesec",
            cell: (row) => (
              <Link className="gx-link" href={`/ured/obracun-sati/${row.id}`}>
                {MONTHS[row.month - 1]} {row.year}
              </Link>
            ),
          },
          {
            key: "status",
            header: "Status",
            cell: (row) => <StatusDot tone={statusTone(row.status)} label={STATUS_LABEL[row.status]} />,
          },
          { key: "workers", header: "Radnika", cell: (row) => String(row.worker_count) },
          {
            key: "gross",
            header: "Bruto osnova",
            cell: (row) => (row.gross_total === null ? "—" : row.gross_total),
          },
          { key: "readiness", header: "Spremnost", cell: readinessText },
        ]}
        empty={(
          <EmptyState
            title="Nema perioda"
            description="Otvorite period za mjesec koji obračunavate — obračun se ne pravi sam."
          />
        )}
      />
    </Stack>
  );
}

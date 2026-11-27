/**
 * Model PRIKAZA obračuna — tipovi, formatiranje novca i sabiranje po radniku (F6, spec 07 §4).
 *
 * Odvojeno od komponente jer su to činjenice o novcu, a ne o rasporedu ekrana: testiraju se bez
 * React-a, pa greška u prikazu iznosa pada i kad render ne radi.
 */

export type PeriodStatus = "OPEN" | "CALCULATED" | "APPROVED" | "LOCKED";

export type Period = {
  id: string;
  year: number;
  month: number;
  status: PeriodStatus;
  worker_count: number;
  gross_total: string | null;
  revision: number | null;
  blockers: { code: string; count: number; message: string }[];
};

export type PayrollLine = {
  id: string;
  run_id: string;
  worker_id: string;
  worker_name: string;
  component_code: string;
  component_name: string;
  kind: "EARNING" | "DEDUCTION";
  hours: number;
  days: number;
  rate_cents: number | null;
  amount_cents: number | null;
  currency_code: string | null;
  status: "OK" | "RATE_MISSING" | "PARAMETER_MISSING";
  calc_note: string | null;
};

export type LinesPayload = {
  run_id: string | null;
  revision: number | null;
  lines: PayrollLine[];
  totals: {
    earnings_cents: number | null;
    deductions_cents: number | null;
    missing_workers: number;
    currency_code: string | null;
  };
};

export type LineSource = {
  id: string;
  source_type: string;
  source_id: string;
  work_date: string | null;
  hours: number;
  days: number;
  amount_cents: number | null;
  applied_parameters: Record<string, unknown>;
  note: string | null;
};

import { PAYROLL_STATUS_NAMES as STATUS_LABEL } from "@/lib/labels";
export { STATUS_LABEL };

/** Novac iz centi; `null` je crtica, nikad „0,00“ — vidi odluku 1 u zaglavlju fajla. */
export function money(cents: number | null): string {
  if (cents === null) return "—";
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Sati sa do 3 decimale, bez lažne preciznosti (`8` a ne `8,000`). */
export function hours(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
}

export function statusTone(status: PeriodStatus): "ok" | "warn" | "danger" | "muted" {
  if (status === "LOCKED" || status === "APPROVED") return "ok";
  if (status === "CALCULATED") return "warn";
  return "muted";
}

/** Radnik × komponenta: dvije linije istog radnika iste komponente se sabiraju, ne dupliraju. */
export function groupByWorker(lines: PayrollLine[]): Array<{
  workerId: string;
  workerName: string;
  components: Map<string, { code: string; name: string; hours: number; days: number; amount: number | null; status: PayrollLine["status"] }>;
  earnings: number | null;
  deductions: number | null;
  missing: boolean;
}> {
  const byWorker = new Map<string, ReturnType<typeof groupByWorker>[number]>();
  for (const line of lines) {
    const entry = byWorker.get(line.worker_id) ?? {
      workerId: line.worker_id,
      workerName: line.worker_name,
      components: new Map(),
      earnings: 0,
      deductions: 0,
      missing: false,
    };
    const existing = entry.components.get(line.component_code);
    const amount = line.amount_cents;
    entry.components.set(line.component_code, {
      code: line.component_code,
      name: line.component_name,
      hours: (existing?.hours ?? 0) + line.hours,
      days: (existing?.days ?? 0) + line.days,
      amount: amount === null ? null : (existing?.amount ?? 0) + amount,
      status: existing?.status && existing.status !== "OK" ? existing.status : line.status,
    });
    if (line.amount_cents === null) entry.missing = true;
    if (line.amount_cents !== null) {
      if (line.kind === "EARNING") entry.earnings = (entry.earnings ?? 0) + line.amount_cents;
      else entry.deductions = (entry.deductions ?? 0) + line.amount_cents;
    }
    byWorker.set(line.worker_id, entry);
  }
  /* Zbir po radniku je `null` kad ijedna njegova linija nema iznos — djelimičan zbir bi bio
     broj koji izgleda tačan, a nije. */
  return [...byWorker.values()].map((entry) => ({
    ...entry,
    earnings: entry.missing ? null : entry.earnings,
    deductions: entry.missing ? null : entry.deductions,
  }));
}


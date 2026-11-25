/**
 * F6 (Modul 7 §1.6) — izvoz obračuna: XLSX sa DVA lista + CSV kao sekundarni format.
 *
 * Pravila koja izvoz mora poštovati, jer ih računovođa ne može provjeriti u fajlu koji ih prećuti:
 *
 *  1. **Default je samo `LOCKED`.** Opcija „uključi `FOREMAN_CONFIRMED` (provizorno)“ je
 *     eksplicitna i u zaglavlju piše da je provizorna. Bez toga bi isti dan mogao biti izvezen
 *     dvaput — jednom potvrđen, jednom zaključan — i računovođa bi sabrao oba.
 *  2. **`export_format_version` u zaglavlju.** Promjena rasporeda kolona je vidljiva u fajlu, a ne
 *     samo u istoriji repozitorija. Verzija se mijenja kad se kolone promijene, i to je audit akcija.
 *  3. **Dva lista, ne jedan.** `OBRAČUN` je jedan red = radnik; `RASPIS` je jedan red = linija sa
 *     izvorima. Bez `RASPIS`-a se iznos ne može objasniti do dana i parametra.
 */
import ExcelJS from "exceljs";
import type { Pool } from "pg";
import { can } from "./permissions";
import type { PayrollActor } from "./payroll-period-service";
import { listLines, listPeriods } from "./payroll-period-service";
import { isPayrollError } from "./payroll-period-service";

/** Mijenja se kad se raspored kolona promijeni; stara verzija ostaje čitljiva u arhivi. */
export const EXPORT_FORMAT_VERSION = "OBRACUN-1";

export type ExportInput = {
  periodId: string;
  format: "xlsx" | "csv";
  /**
   * Provizorni izvoz: uključuje dane koji su samo `FOREMAN_CONFIRMED` (prije zaključavanja).
   * Eksplicitno, i u fajlu jasno označeno — nikad tiho.
   */
  includeProvisional?: boolean;
};

const CATEGORY_COLUMNS = [
  ["REDOVNI", "Sati redovni"],
  ["PREKOVREMENI", "Sati prekovremeni"],
  ["NOCNI", "Sati noćni"],
  ["NEDJELJA", "Sati nedjelja"],
  ["PRAZNIK", "Sati praznik"],
] as const;

type WorkerAggregate = {
  workerName: string;
  hours: Record<string, number>;
  days: Record<string, number>;
  /** Iznos po komponenti (predznak kao u liniji: odbici su negativni). */
  cents: Record<string, bigint>;
  earningsCents: bigint;
  deductionsCents: bigint;
  missing: string[];
};

function money2(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

export type ExportResult = {
  filename: string;
  contentType: string;
  body: Buffer;
  /** Za test i za audit — koliko je redova ušlo i je li uključen provizorni status. */
  meta: { version: string; provisional: boolean; workers: number; lines: number };
};

export async function buildPayrollExport(
  pool: Pool,
  actor: PayrollActor,
  input: ExportInput,
): Promise<ExportResult | { code: string; message: string }> {
  if (!can(actor.roles, "payroll.hours.export")) {
    return { code: "FORBIDDEN", message: "Nemate pravo izvoza obračuna." };
  }
  const provisional = Boolean(input.includeProvisional);

  const periods = await listPeriods(pool, actor);
  if (isPayrollError(periods)) return { code: periods.code, message: periods.message };
  const period = periods.periods.find((row) => row.id === input.periodId);
  if (!period) return { code: "NOT_FOUND", message: "Period ne postoji." };

  /*
   * Default je isključivo `LOCKED`. `CALCULATED`/`APPROVED` nisu isplaćeni — izvoz takvog perioda
   * bi izgledao kao konačan obračun, a nije. Provizorni izvoz zato postoji kao SVJESNA odluka.
   */
  if (period.status !== "LOCKED" && !provisional) {
    return {
      code: "PERIOD_NOT_READY",
      message:
        period.status === "OPEN"
          ? "Period nije izračunat; nema šta izvesti."
          : "Period nije zaključan. Za probni izvoz uključite „provizorno“ (nije konačan obračun).",
    };
  }

  const linesResult = await listLines(pool, actor, input.periodId);
  if (isPayrollError(linesResult)) return { code: linesResult.code, message: linesResult.message };
  const lines = linesResult.lines;

  // Agregacija po radniku: jedan red = jedan radnik (lista `OBRAČUN`).
  const byWorker = new Map<string, WorkerAggregate>();
  for (const line of lines) {
    const key = line.worker_id;
    if (!byWorker.has(key)) {
      byWorker.set(key, {
        workerName: line.worker_name,
        hours: {},
        days: {},
        cents: {},
        earningsCents: 0n,
        deductionsCents: 0n,
        missing: [],
      });
    }
    const aggregate = byWorker.get(key)!;
    if (line.status !== "OK") {
      aggregate.missing.push(`${line.component_code}: ${line.status}`);
      continue;
    }
    if (line.amount_cents === null) continue;
    const cents = BigInt(line.amount_cents);
    aggregate.cents[line.component_code] = (aggregate.cents[line.component_code] ?? 0n) + cents;
    if (cents >= 0n) aggregate.earningsCents += cents;
    else aggregate.deductionsCents += cents;
    if (line.hours > 0) aggregate.hours[line.component_code] = line.hours;
    if (line.days > 0) aggregate.days[line.component_code] = line.days;
  }

  const headerLines = [
    `Obračun ${period.year}/${String(period.month).padStart(2, "0")} — verzija formata ${EXPORT_FORMAT_VERSION}`,
    ...(provisional
      ? [
          "PROVIZORNO: uključeni su dani koji su samo potvrđeni od šefa (FOREMAN_CONFIRMED) i nisu zaključani. Iznosi nisu konačni obračun.",
        ]
      : ["Konačan obračun: uključeni su samo zaključani (LOCKED) dani."]),
    `Stanje perioda: ${period.status}`,
  ];

  const columns = [
    "Radnik",
    ...CATEGORY_COLUMNS.map(([, label]) => label),
    "Dani bolovanja",
    "Dani godišnjeg",
    "Dani terenski",
    "Terenski dodatak",
    "Akontacija",
    "Pozajmica",
    "Ukupno zarade",
    "Ukupno odbici",
    "Bruto osnova",
    "Nedostaje",
  ];

  const rows = [...byWorker.values()]
    .sort((a, b) => a.workerName.localeCompare(b.workerName, "bs"))
    .map((worker) => [
      worker.workerName,
      ...CATEGORY_COLUMNS.map(([code]) => worker.hours[code] ?? 0),
      worker.days.BOLOVANJE ?? 0,
      worker.days.GODISNJI ?? 0,
      worker.days.TERENSKI ?? 0,
      money2(worker.cents.TERENSKI ?? 0n),
      // Odbici se u koloni prikazuju kao pozitivan iznos („koliko se odbija“), a u linijama su
      // negativni da zbir zarada + odbici daje neto.
      money2(-(worker.cents.AKONTACIJA ?? 0n)),
      money2(-(worker.cents.POZAJMICA ?? 0n)),
      money2(worker.earningsCents + worker.deductionsCents),
      money2(worker.deductionsCents),
      /* Bruto osnova je zarada BEZ odbitaka; kad ijedna linija nema iznos, ovdje je prazno, a ne
         zbir ostalih — djelimičan zbir bi izgledao tačan. */
      worker.missing.length > 0 ? "" : money2(worker.earningsCents),
      worker.missing.join("; "),
    ]);

  const raspisColumns = [
    "Radnik",
    "Komponenta",
    "Sati",
    "Dani",
    "Satnica (centi)",
    "Iznos",
    "Status",
    "Napomena",
  ];
  const raspisRows = lines.map((line) => [
    line.worker_name,
    line.component_code,
    line.hours,
    line.days,
    line.rate_cents,
    line.amount_cents === null ? "" : money2(BigInt(line.amount_cents)),
    line.status,
    line.calc_note ?? "",
  ]);

  const meta = {
    version: EXPORT_FORMAT_VERSION,
    provisional,
    workers: byWorker.size,
    lines: lines.length,
  };

  if (input.format === "csv") {
    const csv = toCsv(headerLines, columns, rows);
    return {
      filename: `obracun-${period.year}-${String(period.month).padStart(2, "0")}${provisional ? "-provizorno" : ""}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: Buffer.from(csv, "utf8"),
      meta,
    };
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Gradix";
  workbook.created = new Date();

  const main = workbook.addWorksheet("OBRAČUN");
  for (const line of headerLines) main.addRow([line]);
  main.addRow([]);
  main.addRow(columns);
  for (const row of rows) main.addRow(row);
  main.getRow(headerLines.length + 3).font = { bold: true };
  main.columns.forEach((column, index) => {
    column.width = index === 0 ? 28 : 16;
  });

  const raspis = workbook.addWorksheet("RASPIS");
  raspis.addRow([...headerLines]);
  raspis.addRow([]);
  raspis.addRow(raspisColumns);
  for (const row of raspisRows) raspis.addRow(row);
  raspis.getRow(headerLines.length + 3).font = { bold: true };
  raspis.columns.forEach((column, index) => {
    column.width = index === 1 ? 24 : 14;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    filename: `obracun-${period.year}-${String(period.month).padStart(2, "0")}${provisional ? "-provizorno" : ""}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: Buffer.from(buffer),
    meta,
  };
}

/**
 * CSV sa zaglavljem. Ćelije se citiraju samo kad sadrže zarez, navodnik ili prelom reda — isto
 * pravilo kao `listHoursForExport`, pa se dva izvoza ponašaju jednako.
 */
function toCsv(
  headerLines: string[],
  columns: string[],
  rows: (string | number | null)[][],
): string {
  const escape = (value: string | number | null): string => {
    if (value === null) return "";
    const text = String(value);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines: string[] = [];
  for (const line of headerLines) lines.push(escape(line));
  lines.push("");
  lines.push(columns.map(escape).join(","));
  for (const row of rows) lines.push(row.map(escape).join(","));
  return `${lines.join("\n")}\n`;
}

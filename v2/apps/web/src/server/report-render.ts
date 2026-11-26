/** Pure renderers: callers MUST authorize and filter data before passing it here. */
import ExcelJS from "exceljs";
import { REPORT_DEFINITIONS, type ReportKey } from "@gradix/domain";
import { buildObligationsPdf } from "./obligation-export-service";

export type ReportDocument = {
  key: ReportKey;
  generatedBy: string;
  generatedAt: string;
  from: string;
  to: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
};

function validate(doc: ReportDocument): void {
  if (!Object.hasOwn(REPORT_DEFINITIONS,doc.key) || !doc.generatedBy || !Number.isFinite(Date.parse(doc.generatedAt)) ||
      !doc.columns.length || doc.columns.length > 32 || doc.rows.length > 10_000 ||
      doc.rows.some(r=>r.length !== doc.columns.length)) throw new Error("INVALID_REPORT_DOCUMENT");
}

/** PDF core Helvetica is ASCII-only, matching the existing obligations PDF implementation. */
export function renderReportPdf(doc: ReportDocument): Uint8Array {
  validate(doc);
  const rows: string[][] = [];
  for (const record of doc.rows) {
    for (const [i, value] of record.entries()) {
      const text = `${doc.columns[i]}: ${value}`.replace(/\s+/g," ").trim();
      for (let offset=0; offset<text.length; offset+=110) rows.push([text.slice(offset,offset+110)]);
    }
    rows.push([""]);
  }
  return buildObligationsPdf({title:REPORT_DEFINITIONS[doc.key].title,
    subtitle:`Period: ${doc.from} - ${doc.to}`,
    footer:`Generisao: ${doc.generatedBy}; ${doc.generatedAt}`,
    columns:[{header:"Stavke",width:770}],rows});
}

/** XLSX uses only string cell values: user-controlled text is never interpreted as a formula. */
export async function renderReportXlsx(doc: ReportDocument): Promise<Uint8Array> {
  validate(doc);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = doc.generatedBy;
  workbook.created = new Date(doc.generatedAt);
  const sheet = workbook.addWorksheet("Izvještaj");
  sheet.addRow([REPORT_DEFINITIONS[doc.key].title]);
  sheet.addRow([`Period: ${doc.from} - ${doc.to}`]);
  sheet.addRow([...doc.columns]);
  for (const row of doc.rows) sheet.addRow([...row]);
  sheet.addRow([]);
  sheet.addRow([`Generisao: ${doc.generatedBy}; ${doc.generatedAt}`]);
  sheet.headerFooter.oddFooter = `Generisao: ${doc.generatedBy.replace(/&/g, "")} - ${doc.generatedAt}   Strana &P od &N`;
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

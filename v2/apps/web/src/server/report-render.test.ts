import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { REPORT_DEFINITIONS, type ReportKey } from "@gradix/domain";
import { renderReportPdf, renderReportXlsx } from "./report-render";

describe("zajednički render izvještaja (bez izvora podataka)", () => {
  for (const key of Object.keys(REPORT_DEFINITIONS) as ReportKey[]) {
    it(`${key}: PDF i XLSX nose iste redove i autora`, async () => {
      const doc={key,generatedBy:"autor",generatedAt:"2026-11-01T12:00:00.000Z",from:"2026-10-01",to:"2026-10-31",
        columns:["Kod","Vrijednost"],rows:[["Red-1","=2+3"],["Red-2","123.45"]]};
      const pdf=Buffer.from(renderReportPdf(doc)).toString("latin1");
      expect(pdf.startsWith("%PDF-")).toBe(true); expect(pdf).toContain("Red-1"); expect(pdf).toContain("autor");
      const wb=new ExcelJS.Workbook(); await wb.xlsx.load(await renderReportXlsx(doc) as never);
      const ws=wb.getWorksheet("Izvještaj")!;
      expect(ws.getCell("A4").value).toBe("Red-1"); expect(ws.getCell("B4").value).toBe("=2+3");
      expect(ws.getCell("B4").type).toBe(ExcelJS.ValueType.String);
      expect(ws.getRow(7).getCell(1).value).toContain("autor");
    });
  }
  it("odbija nepotpunu tabelu", () => expect(()=>renderReportPdf({key:"HSE",generatedBy:"a",generatedAt:new Date().toISOString(),
    from:"2026-01-01",to:"2026-01-31",columns:["A","B"],rows:[["A"]]})).toThrow("INVALID_REPORT_DOCUMENT"));
});

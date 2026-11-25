/**
 * F9 — mjesečni HSE izvještaj u PDF-u (spec 10 §1.6/30).
 *
 * Sadržaj prati statistiku koju ekran pokazuje, u istom redu: period, odrađeni sati, incidenti po
 * težini i vrsti, `NEAR_MISS` ODVOJENO (§1.3/12), izgubljeni dani, LTIFR, mjere (otvorene/kasne/%
 * na vrijeme), obuke i aktivna zabrana rada.
 *
 * Zašto `NEAR_MISS` odvojeno i na papiru: kada se sabere sa nesrećama, preventivni signal nestane
 * u broju koji raste samo kad je već kasno. `DRAFT_FORMAT` se ovdje NE koristi — to je oznaka
 * obrasca dnevnika; HSE izvještaj je interni pregled i to piše u podnožju.
 */
import type { HseStats } from "./hse-service";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 40;
const LINE_HEIGHT = 15;

function toAscii(value: string): string {
  return value
    .replace(/[čć]/g, "c")
    .replace(/[ČĆ]/g, "C")
    .replace(/š/g, "s")
    .replace(/Š/g, "S")
    .replace(/ž/g, "z")
    .replace(/Ž/g, "Z")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[–—]/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

function pdfString(value: string): string {
  return `(${toAscii(value).replace(/[\\()]/g, (char) => `\\${char}`)})`;
}

const SEVERITY_LABELS: Record<string, string> = {
  MINOR: "lake",
  MODERATE: "umjerene",
  SEVERE: "teske",
  FATAL: "smrtne",
};

const KIND_LABELS: Record<string, string> = {
  ACCIDENT: "nesrece",
  NEAR_MISS: "neplanirani dogadjaji (NEAR_MISS)",
  PROPERTY_DAMAGE: "steta na imovini",
  ENVIRONMENTAL: "okolis",
  OCCUPATIONAL_ILLNESS: "bolesti u vezi s radom",
};

const percent = (value: number | null): string => (value === null ? "nema podataka" : `${value.toFixed(1)}%`);

export function buildHseReportPdf(stats: HseStats, companyName: string): Uint8Array {
  const lines: Array<{ text: string; bold?: boolean; size?: number }> = [
    { text: companyName, bold: true, size: 13 },
    { text: "HSE IZVJESTAJ", bold: true, size: 12 },
    { text: `Period: ${stats.from} - ${stats.to}` },
    { text: "" },
    { text: "OBIM RADA", bold: true },
    { text: `Odradjeni sati (Modul 3): ${stats.workedHours.toFixed(2)} h` },
    { text: "" },
    { text: "INCIDENTI", bold: true },
    { text: `Ukupno: ${stats.incidents}` },
  ];

  for (const [severity, count] of Object.entries(stats.bySeverity)) {
    lines.push({ text: `  ${SEVERITY_LABELS[severity] ?? severity}: ${count}` });
  }
  for (const [kind, count] of Object.entries(stats.byKind)) {
    lines.push({ text: `  ${KIND_LABELS[kind] ?? kind}: ${count}` });
  }
  lines.push({ text: `NEAR_MISS (odvojeno): ${stats.nearMisses}`, bold: true });
  lines.push({ text: "" });

  lines.push({ text: "POKAZATELJI", bold: true });
  lines.push({ text: `Izgubljeni dani: ${stats.lostDays}` });
  /* LTIFR je izračun na milion sati; `null` znači da nema sati, a ne da je stopa nula. */
  lines.push({ text: `LTIFR (na 1.000.000 sati): ${stats.ltifr === null ? "nema podataka o satima" : stats.ltifr.toFixed(2)}` });
  lines.push({ text: "" });

  lines.push({ text: "KOREKTIVNE MJERE", bold: true });
  lines.push({ text: `Otvorene: ${stats.actions.open}` });
  lines.push({ text: `Kasne: ${stats.actions.overdue}` });
  lines.push({ text: `Na vrijeme: ${percent(stats.actions.onTimeRate)}` });
  lines.push({ text: "" });

  lines.push({ text: "OBUKE", bold: true });
  lines.push({ text: `Odrzane obuke: ${stats.trainings.count} (toolbox: ${stats.trainings.toolbox})` });
  lines.push({ text: `Prisustva (potpisi): ${stats.trainings.attendees}` });
  lines.push({ text: "" });

  if (stats.activeProhibition) {
    lines.push({ text: "AKTIVNA ZABRANA RADA", bold: true });
    lines.push({ text: `  Nalaz ${stats.activeProhibition.id}, ${stats.activeProhibition.inspectedAt.slice(0, 10)}, ${stats.activeProhibition.authorityName ?? "inspekcija"}` });
    lines.push({ text: "" });
  }

  lines.push({ text: "Interni pregled stanja; nije zamjena za zapisnik inspekcije.", size: 7 });

  const chunk = Math.max(1, Math.ceil(lines.length / 45));
  const pages: string[] = [];
  for (let page = 0; page < chunk; page += 1) {
    const ops: string[] = [];
    let y = PAGE_HEIGHT - MARGIN;
    for (const line of lines.slice(page * 45, (page + 1) * 45)) {
      if (line.text.length > 0) {
        ops.push(`BT /${line.bold ? "F2" : "F1"} ${line.size ?? 9} Tf 1 0 0 1 ${MARGIN} ${y} Tm ${pdfString(line.text)} Tj ET`);
      }
      y -= LINE_HEIGHT;
    }
    ops.push(`BT /F1 7 Tf 1 0 0 1 ${PAGE_WIDTH - MARGIN - 60} ${MARGIN - 22} Tm ${pdfString(`strana ${page + 1}/${chunk}`)} Tj ET`);
    pages.push(ops.join("\n"));
  }

  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  pages.forEach((content, index) => {
    const contentId = pageObjectIds[index]! + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

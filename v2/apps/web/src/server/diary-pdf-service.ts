/**
 * F9 — PDF dnevnika građenja (spec 10 §1.7/31-33).
 *
 * Odluke:
 *
 *  1. **Bez biblioteke.** Isti pristup kao `obligation-export-service`: dokument je tekst, linije i
 *     nekoliko pravougaonika. `pdfkit` bi dodao megabajte zavisnosti i fontove za jedan obrazac.
 *  2. **Portret A4, sekcije po šablonu firme.** Redoslijed sekcija dolazi iz `site_diary_templates`
 *     (§1.7/31), a ne iz koda — firma mijenja obrazac bez izdanja.
 *  3. **`DRAFT_FORMAT` dok vlasnik/pravnik ne potvrdi šablon** (§1.7/32). Oznaka ide u PEČAT na
 *     svakoj strani, ne u fusnotu: dokument koji izgleda kao zakonski obrazac, a nije potvrđen,
 *     mora to reći na svakom listu.
 *  4. **Zamrznuti podaci.** PDF se pravi iz `auto_snapshot` kad je dnevnik potpisan — potpisani
 *     papir i ekran moraju imati iste brojeve, i poslije izmjena u Modulu 3/5.
 *  5. **Dijakritika → ASCII**, isto kao u F2: Helvetica iz PDF jezgre ne poznaje `č ć ž š đ`, a
 *     lažni glyph je gori od slova bez kvake.
 */
import type { DiaryDetail } from "./diary-service";
import type { DiaryTemplate, DiaryTemplateSection } from "./diary-template-service";
import { DRAFT_FORMAT_LABEL } from "./diary-template-service";

const PAGE_WIDTH = 595; // A4 portrait
const PAGE_HEIGHT = 842;
const MARGIN = 40;
const LINE_HEIGHT = 13;
const BODY_SIZE = 9;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2 - 90) / LINE_HEIGHT);

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
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

function pdfString(value: string): string {
  return `(${toAscii(value).replace(/[\\()]/g, (char) => `\\${char}`)})`;
}

type Line = { text: string; bold?: boolean; size?: number; indent?: number };

const WEATHER_LABELS: Record<string, string> = {
  CLEAR: "vedro",
  CLOUDY: "oblačno",
  RAIN: "kiša",
  SNOW: "snijeg",
  WIND: "vjetar",
  FROST: "mraz",
  HEAT: "vrućina",
};

const DELAY_LABELS: Record<string, string> = {
  RAIN: "kiša",
  SNOW: "snijeg",
  WIND: "vjetar",
  FROST: "mraz",
  SUBCONTRACTOR: "podizvođač",
  MATERIAL: "materijal",
  PERMIT: "dozvola",
  OTHER: "ostalo",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "NACRT (nije potpisan)",
  SIGNED: "POTPISAN",
  LOCKED: "ZAKLJUČAN",
};

const formatDate = (value: string): string => {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}.${month}.${year}.`;
};

const clock = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
};

/** Tekst se lomi po riječima; PDF ne zna da prelama red, pa se lomi OVDJE, prije upisa. */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

const WRAP_WIDTH = 105;

/** Sekcije po šablonu: `enabled` i redoslijed iz baze, sadržaj iz dnevnika. */
function buildLines(detail: DiaryDetail, template: DiaryTemplate): Line[] {
  const lines: Line[] = [];
  const { diary, auto, delays, items } = detail;

  lines.push({ text: template.header.companyLine ?? "", bold: true, size: 13 });
  lines.push({ text: `${diary.projectCode} — ${diary.projectName}`, bold: true, size: 11 });
  lines.push({ text: `DNEVNIK GRAĐENJA — ${formatDate(diary.diaryDate)}   (${STATUS_LABELS[diary.status] ?? diary.status})`, bold: true, size: 11 });
  if (template.header.projectLine) lines.push({ text: template.header.projectLine });
  lines.push({ text: "" });

  const enabled = template.sections.filter((section) => section.enabled);
  for (const section of enabled) {
    const body = sectionLines(section, detail, auto);
    if (body.length === 0) continue;
    lines.push({ text: section.label.toUpperCase(), bold: true });
    lines.push(...body);
    lines.push({ text: "" });
  }

  /* Zastoji i zbroj: dokaz za produženje roka, pa zbroj mora biti na papiru. */
  lines.push({ text: "ZASTOJI", bold: true });
  if (delays.length === 0) {
    lines.push({ text: "Nema evidentiranih zastoja.", indent: 10 });
  } else {
    for (const delay of delays) {
      const extension = delay.extensionDays === null ? "" : ` · aneks produžava ${delay.extensionDays} d`;
      lines.push({
        text: `${DELAY_LABELS[delay.kind] ?? delay.kind}: ${clock(delay.fromAt)}–${clock(delay.toAt)} = ${delay.hours} h${extension}${delay.note ? ` (${delay.note})` : ""}`,
        indent: 10,
      });
    }
    lines.push({ text: `Ukupno zastoja: ${detail.delayHoursTotal} h`, bold: true, indent: 10 });
  }
  lines.push({ text: "" });

  lines.push({ text: "POTPISI", bold: true });
  lines.push({ text: `Izvođač: ${diary.signedName ?? "_______________________"}` });
  if (diary.signedAt) lines.push({ text: `Potpisano: ${formatDate(diary.signedAt)} ${clock(diary.signedAt)}` });
  lines.push({ text: "Nadzor: ______________________________" });
  lines.push({ text: "Investitor: __________________________" });
  lines.push({ text: "" });

  /* Šta je automatski preuzeto i kada — bez toga PDF ne kaže odakle brojevi. */
  lines.push({
    text: `Automatski podaci iz radnih dana, sati mašina, tura i kvarova; stanje na ${formatDate(auto.generatedAt)} ${clock(auto.generatedAt)}.${detail.frozen ? " Podaci su zamrznuti u trenutku potpisa." : ""}`,
    size: 7,
  });
  if (template.header.legalNote) {
    for (const chunk of wrap(template.header.legalNote, WRAP_WIDTH)) lines.push({ text: chunk, size: 7 });
  }
  lines.push({ text: `Broj izvedenih stavki: ${items.length}.`, size: 7 });
  /* Realan bug ako se preskoči: prazna sekcija bez ijedne stavke tvrdi da radova nije bilo. */
  if (enabled.length === 0) lines.push({ text: "Šablon nema uključenih sekcija — provjerite postavke obrasca.", size: 7 });
  return lines;
}

function sectionLines(
  section: DiaryTemplateSection,
  detail: DiaryDetail,
  auto: DiaryDetail["auto"],
): Line[] {
  const { diary, items } = detail;
  switch (section.key) {
    case "HEADER":
      return [];
    case "WEATHER": {
      const out: Line[] = [];
      if (diary.weather) out.push({ text: `Vrijeme: ${WEATHER_LABELS[diary.weather] ?? diary.weather}${diary.temperatureC ? `, ${diary.temperatureC} °C` : ""}`, indent: 10 });
      if (diary.workedHours) out.push({ text: `Radni sati na gradilištu: ${diary.workedHours} h`, indent: 10 });
      if (out.length === 0) out.push({ text: "Vrijeme nije upisano.", indent: 10 });
      return out;
    }
    case "WORKERS":
      return auto.workers.length === 0
        ? [{ text: "Nema evidentiranih radnika za ovaj projekat i dan.", indent: 10 }]
        : auto.workers.map((worker) => ({ text: `${worker.workerName}: ${worker.hours} h`, indent: 10 }));
    case "MACHINES":
      return auto.machines.length === 0
        ? [{ text: "Nema evidentiranih sati mašina.", indent: 10 }]
        : auto.machines.map((machine) => ({
          text: `${machine.machineCode} ${machine.machineName}: ${machine.hours} h${machine.meterFrom && machine.meterTo ? ` (brojilo ${machine.meterFrom}→${machine.meterTo})` : ""}`,
          indent: 10,
        }));
    case "QUANTITIES":
      return items.length === 0
        ? [{ text: "Nema unesenih količina.", indent: 10 }]
        : items.map((item) => ({
          text: `${item.boqCode ? `[${item.boqCode}] ` : ""}${item.description}: ${item.quantity} ${item.unit} (${item.source})`,
          indent: 10,
        }));
    case "HAULS":
      return auto.hauls.length === 0
        ? [{ text: "Nema tura.", indent: 10 }]
        : auto.hauls.map((haul) => ({
          text: `${haul.machineName} — ${haul.material ?? "materijal"}: ${haul.quantity} ${haul.quantityUnit}`,
          indent: 10,
        }));
    case "EVENTS": {
      const out: Line[] = [];
      for (const chunk of wrap(diary.description ?? "", WRAP_WIDTH)) out.push({ text: chunk, indent: 10 });
      if (diary.visitors) for (const chunk of wrap(`Posjetioci: ${diary.visitors}`, WRAP_WIDTH)) out.push({ text: chunk, indent: 10 });
      if (diary.events) for (const chunk of wrap(`Događaji: ${diary.events}`, WRAP_WIDTH)) out.push({ text: chunk, indent: 10 });
      return out;
    }
    case "DELAYS":
      /* Zastoji imaju svoju sekciju na kraju (sa zbrojem) — ovdje se ne dupliraju. */
      return [];
    case "ATTACHMENTS":
      return detail.attachments.length === 0
        ? [{ text: "Nema priloga.", indent: 10 }]
        : detail.attachments.map((file) => ({
          text: `${file.file_name}${file.status === "pending" ? " (upload u toku)" : ""}`,
          indent: 10,
        }));
    case "SIGNATURES":
      return [];
  }
}

/**
 * Skripta za crtanje PDF-a. Isti objekat-broj obrazac kao F2: katalog, pages, dva fonta, pa
 * stranice od 5; `xref` iz stvarnih ofseta u `latin1`.
 */
export function buildDiaryPdf(detail: DiaryDetail, template: DiaryTemplate): Uint8Array {
  const lines = buildLines(detail, template);
  const chunkCount = Math.max(1, Math.ceil(lines.length / LINES_PER_PAGE));
  const pages: string[] = [];

  for (let page = 0; page < chunkCount; page += 1) {
    const ops: string[] = [];
    let y = PAGE_HEIGHT - MARGIN;

    /* `DRAFT_FORMAT` pečat na SVAKOJ strani — vidi zaglavlje fajla, odluka 3. */
    if (template.draftFormat) {
      ops.push(`0.8 w 1 0.85 0.85 rg ${MARGIN} ${y - 10} ${PAGE_WIDTH - MARGIN * 2} 22 re f`);
      ops.push(`BT /F2 8 Tf 1 0 0 1 ${MARGIN + 6} ${y - 3} Tm ${pdfString(DRAFT_FORMAT_LABEL)} Tj ET`);
      ops.push(`0 0 0 rg`);
      y -= 26;
    }

    for (const line of lines.slice(page * LINES_PER_PAGE, (page + 1) * LINES_PER_PAGE)) {
      if (line.text.length > 0) {
        const size = line.size ?? BODY_SIZE;
        const font = line.bold ? "F2" : "F1";
        const x = MARGIN + (line.indent ?? 0);
        ops.push(`BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm ${pdfString(line.text)} Tj ET`);
      }
      y -= LINE_HEIGHT;
    }

    ops.push(`0.5 w ${MARGIN} ${MARGIN - 10} m ${PAGE_WIDTH - MARGIN} ${MARGIN - 10} l S`);
    ops.push(
      `BT /F1 7 Tf 1 0 0 1 ${MARGIN} ${MARGIN - 22} Tm ${pdfString(`${detail.diary.projectCode} · ${formatDate(detail.diary.diaryDate)} · dnevnik ${detail.diary.id}`)} Tj ET`,
    );
    ops.push(
      `BT /F1 7 Tf 1 0 0 1 ${PAGE_WIDTH - MARGIN - 60} ${MARGIN - 22} Tm ${pdfString(`strana ${page + 1}/${chunkCount}`)} Tj ET`,
    );
    pages.push(ops.join("\n"));
  }

  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
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

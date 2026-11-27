/**
 * F2 — izvoz rokova u CSV i PDF (§10).
 *
 * CSV je za dalju obradu (Excel), PDF je za štampu i potpis — „spisak rokova koji istječu“ ide
 * na sastanak. Isti redovi, isti filteri, dva oblika: `buildObligationsCsv` i `buildObligationsPdf`
 * primaju isti niz, pa se ne mogu razići u sadržaju.
 *
 * PDF se pravi ručno, bez biblioteke: radi se o tabeli teksta i nekoliko linija. Uvođenje
 * `pdfkit`-a bi dodalo 3 MB zavisnosti (i fontove) za jedan izvještaj.
 *
 * O dijakritici u PDF-u: standardni Helvetica iz PDF jezgre ne sadrži `č ć ž š đ`, a lažni
 * glyph (`` ili `?`) je gori od slova bez kvake. Zato se u PDF-u ti znakovi prevode u ASCII
 * (`č`→`c`), dok CSV ostaje tačan (UTF-8 sa BOM-om, Excel ga otvara ispravno). To je svjesna
 * razlika između dva formata, ne propust — PDF se čita kao papir, CSV se obrađuje.
 */

export type ObligationExportRow = {
  typeLabel: string;
  entityKind: string;
  entityName: string;
  number: string | null;
  issuer: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  reviewAt: string | null;
  state: string;
  stateLabel: string;
  daysLeft: number | null;
  responsibleName: string | null;
  note: string | null;
};

const STATE_LABELS_SR: Record<string, string> = {
  missing: "Nedostaje",
  expired: "Isteklo",
  rejected: "Odbijeno",
  pending_review: "Ceka provjeru",
  expiring: "Uskoro istjece",
  review_due: "Provjera dospjela",
  valid: "Vazece",
  no_expiry: "Bez roka",
  superseded: "Zamijenjeno",
};

const ENTITY_LABELS_SR: Record<string, string> = {
  WORKER: "Radnik",
  MACHINE: "Masina",
  PROJECT: "Projekat",
  COMPANY: "Firma",
  TENDER: "Tender",
};

/** Ćelija po RFC 4180 — navodnici, zarezi i prelomi reda se escape-uju. */
export function escapeCsvCell(value: string): string {
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

const BOM = "\uFEFF";
const CSV_HEADER = [
  "tip",
  "vrsta entiteta",
  "entitet",
  "broj",
  "izdavalac",
  "izdato",
  "istice",
  "provjera",
  "stanje",
  "dana do roka",
  "odgovorna osoba",
  "napomena",
].join(",");

export function buildObligationsCsv(rows: readonly ObligationExportRow[]): string {
  const lines = [CSV_HEADER];
  for (const row of rows) {
    lines.push(
      [
        row.typeLabel,
        ENTITY_LABELS_SR[row.entityKind] ?? row.entityKind,
        row.entityName,
        row.number ?? "",
        row.issuer ?? "",
        row.issuedAt ?? "",
        row.expiresAt ?? "",
        row.reviewAt ?? "",
        row.stateLabel,
        row.daysLeft === null ? "" : String(row.daysLeft),
        row.responsibleName ?? "",
        row.note ?? "",
      ]
        .map((cell) => escapeCsvCell(cell))
        .join(","),
    );
  }
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Zamjena dijakritike za PDF jezgrinu Helvetiku — vidi zaglavlje fajla. */
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
    // Zamjena za znakove koje WinAnsi ne poznaje (crtice, navodnici iz Copy/Paste-a).
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

/** PDF string: `(` `)` i `\` se escape-uju, sve ostalo je ASCII poslije `toAscii`. */
function pdfString(value: string): string {
  return `(${toAscii(value).replace(/[\\()]/g, (char) => `\\${char}`)})`;
}

export type PdfOptions = {
  title: string;
  subtitle?: string;
  /** Izvor i vrijeme nastanka, vidljivo na svakoj stranici. */
  footer?: string;
  /** Kolone tabele: širina u bodovima i zaglavlje. */
  columns: ReadonlyArray<{ header: string; width: number }>;
  rows: ReadonlyArray<readonly string[]>;
};

const PAGE_WIDTH = 842; // A4 landscape — 12 kolona stane bez lomljenja reda
const PAGE_HEIGHT = 595;
const MARGIN = 32;
const LINE_HEIGHT = 13;
const ROWS_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2 - 60) / LINE_HEIGHT);

/**
 * Pravi PDF sa tabelom. Vraća `Uint8Array` — rutina ga pretvara u `Response` bez kopije.
 *
 * Struktura: 1 katalog → 2 pages → 3 font → 4..N sadržaj stranica. `xref` se računa iz
 * stvarnih ofseta; bez toga PDF čitači otvaraju dokument sa upozorenjem ili ne otvaraju.
 */
export function buildObligationsPdf(options: PdfOptions): Uint8Array {
  const pages: string[] = [];
  const header = options.columns.map((column) => column.header);
  const rows = options.rows;

  const chunkCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  for (let page = 0; page < chunkCount; page += 1) {
    const from = page * ROWS_PER_PAGE;
    const slice = rows.slice(from, from + ROWS_PER_PAGE);
    const ops: string[] = [];

    let y = PAGE_HEIGHT - MARGIN;
    ops.push(`BT /F2 14 Tf 1 0 0 1 ${MARGIN} ${y} Tm ${pdfString(options.title)} Tj ET`);
    y -= 18;
    if (options.subtitle) {
      ops.push(`BT /F1 9 Tf 1 0 0 1 ${MARGIN} ${y} Tm ${pdfString(options.subtitle)} Tj ET`);
      y -= 6;
    }
    // Linija ispod zaglavlja.
    ops.push(`0.6 w ${MARGIN} ${y} m ${PAGE_WIDTH - MARGIN} ${y} l S`);
    y -= LINE_HEIGHT;

    const drawRow = (cells: readonly string[], bold: boolean) => {
      let x = MARGIN;
      cells.forEach((cell, index) => {
        const column = options.columns[index];
        if (!column) return;
        const text = cell.length > 0 ? cell : "";
        ops.push(
          `BT /${bold ? "F2" : "F1"} 8 Tf 1 0 0 1 ${x} ${y} Tm ${pdfString(text)} Tj ET`,
        );
        x += column.width;
      });
      y -= LINE_HEIGHT;
    };

    drawRow(header, true);
    for (const row of slice) drawRow(row, false);

    if (options.footer) {
      ops.push(`BT /F1 7 Tf 1 0 0 1 ${MARGIN} ${MARGIN - 12} Tm ${pdfString(options.footer)} Tj ET`);
    }
    // Broj stranice ide na dno: izvještaj odštampan u 3 dijela mora imati red.
    ops.push(
      `BT /F1 8 Tf 1 0 0 1 ${PAGE_WIDTH - MARGIN - 40} ${MARGIN - 12} Tm ${pdfString(`strana ${page + 1}/${chunkCount}`)} Tj ET`,
    );
    pages.push(ops.join("\n"));
  }

  // Sklapanje PDF-a: objekti se broje unaprijed jer `/Length` mora biti tačan.
  const objects: string[] = [];
  // Numeracija: 1 katalog, 2 pages, 3 font, 4 bold font, pa stranice od 5 (strana, sadržaj).
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  // F1 = Helvetica, F2 = Helvetica-Bold. WinAnsi je podrazumijevano kodiranje za ove fontove.
  // Svaki font je SVOJ objekat: dva rječnika u jednom objektu PDF čitač ne prihvata.
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
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  // `latin1` je namjeran: svaki znak je jedan bajt i ofseti iz `byteLength` su tačni.
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

/** Kolone izvještaja — jedno mjesto, pa CSV zaglavlje i PDF tabela opisuju iste podatke. */
export const OBLIGATION_EXPORT_COLUMNS = [
  { header: "Tip", width: 110, field: "typeLabel" },
  { header: "Entitet", width: 150, field: "entityName" },
  { header: "Broj", width: 80, field: "number" },
  { header: "Istice", width: 62, field: "expiresAt" },
  { header: "Provjera", width: 62, field: "reviewAt" },
  { header: "Stanje", width: 90, field: "stateLabel" },
  { header: "Dana", width: 34, field: "daysLeft" },
  { header: "Odgovoran", width: 120, field: "responsibleName" },
] as const;

export function pdfRowsFrom(rows: readonly ObligationExportRow[]): string[][] {
  return rows.map((row) =>
    OBLIGATION_EXPORT_COLUMNS.map((column) => {
      const value = row[column.field as keyof ObligationExportRow];
      if (value === null || value === undefined) return "";
      return String(value);
    }),
  );
}

export { STATE_LABELS_SR, ENTITY_LABELS_SR };

/**
 * Čitanje Excela/CSV-a u redove — bez ijednog upisa u bazu.
 *
 * Odvojeno od `import-service.ts` namjerno: parsiranje je čista funkcija nad bajtovima, pa se
 * testira bez baze i bez sesije. Ono što ova datoteka NE radi: ne odlučuje o duplikatima i ne
 * dodaje kategorije — to su pravila poslovanja i žive u servisu.
 *
 * Ograničenja (docs/PLAN-R2.md §2.2): 5 MB, 5.000 redova, samo prvi list, sirovi fajl se ne čuva.
 */
import ExcelJS from "exceljs";

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5_000;
export const MAX_SECONDS = 10;

export type ParsedSheet = {
  headers: string[];
  /** Redovi kao string/number/Date, bez tumačenja značenja kolona. */
  rows: RawRow[];
  /** Koliko je listova ignorisano — prijavljuje se, ne prećutkuje. */
  ignoredSheets: number;
  sheetName: string;
};

export type RawRow = {
  /** Broj reda u datoteci (1 = zaglavlje), da poruka o grešci pokaže pravi red. */
  rowNumber: number;
  cells: Record<string, string | number | Date | null>;
};

export type ParseError =
  | { code: "FILE_TOO_LARGE"; message: string }
  | { code: "TOO_MANY_ROWS"; message: string }
  | { code: "EMPTY_HEADER"; message: string }
  | { code: "UNSUPPORTED_FILE"; message: string }
  | { code: "UNREADABLE"; message: string };

/** Zaglavlje se normalizuje da mapiranje ne zavisi od velikih slova, dijakritike ni razmaka. */
export function normaliseHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function headerName(cell: ExcelJS.Cell, index: number): string {
  const text = String(cell.text ?? "").trim();
  return text === "" ? `kolona_${index + 1}` : text;
}

/**
 * Ćelija u primitiv: tekst ostaje tekst (da se vidi „31.02.2025.“ kao greška, a ne kao datum),
 * broj ostaje broj, datum ostaje datum. Excel serijski broj pretvara ExcelJS kad je ćelija
 * formatirana kao datum — zato se ne pogađa ručno.
 */
function cellValue(cell: ExcelJS.Cell): string | number | Date | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "da" : "ne";

  // Formula, rich text, hiperlink: uzima se prikazani tekst, ne objekat.
  if (typeof value === "object") {
    if ("result" in value && (typeof value.result === "number" || typeof value.result === "string")) {
      return value.result;
    }
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
  }
  return String(cell.text ?? "").trim() || null;
}

/** CSV kao tekst → redovi. Podržava `,` i `;`, navodnike i nove redove unutar polja. */
export function parseCsv(text: string): string[][] {
  // BOM dolazi iz Excela i „pojede“ prvo ime kolone ako se ne skloni odmah.
  const clean = text.replace(/^\uFEFF/, "");
  const delimiter = (clean.split("\n")[0] ?? "").includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index]!;
    if (quoted) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Prazni redovi se preskaču, ali red sa SVIM praznim poljima u zaglavlju NIJE prazan red —
  // to je datoteka bez zaglavlja i mora se prijaviti, ne tiho pretvoriti u podatke.
  return rows.filter((entry, index) => index === 0 || entry.some((cell) => cell.trim() !== ""));
}

export async function parseWorkbook(bytes: Buffer, fileName: string): Promise<ParsedSheet | ParseError> {
  if (bytes.byteLength > MAX_BYTES) {
    return {
      code: "FILE_TOO_LARGE",
      message: "Datoteka je veća od 5 MB. Razdvojite uvoz na više datoteka.",
    };
  }

  const isCsv = /\.csv$/i.test(fileName);
  const isXlsx = /\.xlsx$/i.test(fileName);
  if (!isCsv && !isXlsx) {
    return { code: "UNSUPPORTED_FILE", message: "Prihvata se .xlsx ili .csv." };
  }

  if (isCsv) {
    const rows = parseCsv(bytes.toString("utf8"));
    if (rows.length === 0) return { code: "EMPTY_HEADER", message: "Datoteka je prazna." };
    const rawHeaders = rows[0]!.map((cell) => cell.trim());
    // Sva prazna zaglavlja = nema zaglavlja; pojedinačno prazno dobija ime po redu.
    if (rawHeaders.every((header) => header === "")) {
      return { code: "EMPTY_HEADER", message: "Prvi red je prazan — zaglavlje nedostaje." };
    }
    const headers = rawHeaders.map((cell, index) => (cell === "" ? `kolona_${index + 1}` : cell));
    if (rows.length - 1 > MAX_ROWS) {
      return { code: "TOO_MANY_ROWS", message: `Najviše ${MAX_ROWS} redova po uvozu. Razdvojite datoteku.` };
    }
    return {
      headers,
      sheetName: "csv",
      ignoredSheets: 0,
      rows: rows.slice(1).map((cells, index) => ({
        rowNumber: index + 2,
        cells: Object.fromEntries(headers.map((header, position) => [header, cells[position] ?? null])),
      })),
    };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return { code: "UNREADABLE", message: "Datoteku nije moguće pročitati kao .xlsx." };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return { code: "EMPTY_HEADER", message: "Datoteka nema nijedan list." };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    headers[columnNumber - 1] = headerName(cell, columnNumber - 1);
  });
  if (headers.filter(Boolean).length === 0) {
    return { code: "EMPTY_HEADER", message: "Prvi red je prazan — zaglavlje nedostaje." };
  }
  for (let index = 0; index < headers.length; index += 1) {
    if (!headers[index]) headers[index] = `kolona_${index + 1}`;
  }

  const dataRows: RawRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: Record<string, string | number | Date | null> = {};
    let empty = true;
    for (let index = 0; index < headers.length; index += 1) {
      const value = cellValue(row.getCell(index + 1));
      cells[headers[index]!] = value;
      if (value !== null && value !== "") empty = false;
    }
    if (!empty) dataRows.push({ rowNumber, cells });
  });

  if (dataRows.length > MAX_ROWS) {
    return { code: "TOO_MANY_ROWS", message: `Najviše ${MAX_ROWS} redova po uvozu. Razdvojite datoteku.` };
  }

  return {
    headers: headers.filter(Boolean),
    rows: dataRows,
    // Ostali listovi se ne uvoze; korisnik to mora vidjeti, ne otkriti poslije.
    ignoredSheets: Math.max(workbook.worksheets.length - 1, 0),
    sheetName: sheet.name,
  };
}

/**
 * Datum iz ćelije u `YYYY-MM-DD`. Vraća `null` za neispravan datum — pozivalac to pretvara u
 * grešku reda. Namjerno ne popravlja „31.02.“ u nešto drugo: tihi popravak je gora greška od
 * prijavljene.
 */
export function toIsoDate(value: string | number | Date | null): string | null {
  if (value === null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    // Excel serijski broj (dan 1 = 1900-01-01, sa poznatim bugom za 1900-02-29).
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + value * 86_400_000);
    return toIsoDate(date);
  }

  const text = value.trim();
  let match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/.exec(text);
  if (match) {
    const [, day, month, year] = match;
    const candidate = `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
    return isValidIsoDate(candidate) ? candidate : null;
  }
  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return isValidIsoDate(text) ? text : null;
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) {
    const [, day, month, year] = match;
    const candidate = `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
    return isValidIsoDate(candidate) ? candidate : null;
  }
  return null;
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Broj iz ćelije: prihvata `1.234,5` i `1234.5`; vraća `null` kad nije broj. */
export function toNumber(value: string | number | Date | null): number | null {
  if (value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return null;

  const text = value.trim().replace(/\s/g, "");
  // `1.234,5` → hiljade tačkom, decimale zarezom; inače zarez je decimalni znak ili separator.
  const normalised = /,\d{1,2}$/.test(text)
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/,/g, "");
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toText(value: string | number | Date | null): string | null {
  if (value === null || value === "") return null;
  if (value instanceof Date) return toIsoDate(value);
  return String(value).trim() || null;
}

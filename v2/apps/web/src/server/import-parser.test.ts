/**
 * Parser Excela/CSV-a — bez baze i bez sesije.
 *
 * Testira ono što se u praksi pokvari: datume koji izgledaju kao datumi a nisu, brojeve sa
 * zarezom, `;` kao separator, BOM na početku CSV-a, prekoračenja i prazno zaglavlje.
 */
import { describe, expect, it } from "vitest";
import {
  normaliseHeader,
  parseCsv,
  parseWorkbook,
  toIsoDate,
  toNumber,
  toText,
} from "./import-parser";

const csv = (text: string) => Buffer.from(text, "utf8");

describe("CSV", () => {
  it("prepoznaje `;` kao separator (Excel na našim lokalima)", () => {
    const rows = parseCsv("ime;prezime\nAmina;Karić");
    expect(rows).toEqual([
      ["ime", "prezime"],
      ["Amina", "Karić"],
    ]);
  });

  it("drži zarez unutar navodnika i novi red unutar polja", () => {
    const rows = parseCsv('naziv;opis\n"Bager, CAT";"prvi red\ndrugi red"');
    expect(rows[1]).toEqual(["Bager, CAT", "prvi red\ndrugi red"]);
  });

  it("sklanja BOM i prazne redove", () => {
    const rows = parseCsv("\uFEFFime;prezime\n\nAmina;Karić\n");
    expect(rows[0]).toEqual(["ime", "prezime"]);
    expect(rows).toHaveLength(2);
  });

  it("preko 5.000 redova se odbija sa uputom", async () => {
    const header = "ime,prezime\n";
    const body = Array.from({ length: 5_001 }, (_, index) => `Ime${index},Prezime${index}`).join("\n");
    const result = await parseWorkbook(csv(header + body), "radnici.csv");
    expect("code" in result && result.code).toBe("TOO_MANY_ROWS");
  });

  it("preko 5 MB se odbija", async () => {
    const result = await parseWorkbook(Buffer.alloc(5 * 1024 * 1024 + 1, 65), "radnici.csv");
    expect("code" in result && result.code).toBe("FILE_TOO_LARGE");
  });

  it("nepodržana ekstenzija se odbija", async () => {
    const result = await parseWorkbook(csv("a,b\n1,2"), "radnici.xls");
    expect("code" in result && result.code).toBe("UNSUPPORTED_FILE");
  });

  it("prazno zaglavlje se odbija", async () => {
    const result = await parseWorkbook(csv(",,\n1,2,3"), "prazno.csv");
    expect("code" in result && "message" in result && result.message.length > 0).toBe(true);
  });
});

describe("datumi", () => {
  it("prihvata dd.mm.yyyy, yyyy-mm-dd i dd/mm/yyyy", () => {
    expect(toIsoDate("15.03.2025.")).toBe("2025-03-15");
    expect(toIsoDate("2025-03-15")).toBe("2025-03-15");
    expect(toIsoDate("15/03/2025")).toBe("2025-03-15");
  });

  it("ne popravlja neispravan datum — vraća null", () => {
    // 31. februar ne postoji; tihi popravak na 3. mart je gora greška od prijavljene.
    expect(toIsoDate("31.02.2025.")).toBeNull();
    expect(toIsoDate("2025-02-31")).toBeNull();
    expect(toIsoDate("juče")).toBeNull();
  });

  it("Excel serijski broj pretvara u datum", () => {
    // 45.000 dana od 1899-12-30 = 2023-03-15.
    expect(toIsoDate(45_000)).toBe("2023-03-15");
  });

  it("Date objekat ostaje datum", () => {
    expect(toIsoDate(new Date(Date.UTC(2025, 2, 15)))).toBe("2025-03-15");
  });
});

describe("brojevi", () => {
  it("prihvata `1.234,5` i `1234.5`", () => {
    expect(toNumber("1.234,5")).toBe(1234.5);
    expect(toNumber("1234.5")).toBe(1234.5);
    expect(toNumber("1234,5")).toBe(1234.5);
  });

  it("tekst koji nije broj vraća null", () => {
    expect(toNumber("nema")).toBeNull();
    expect(toNumber("")).toBeNull();
  });
});

describe("zaglavlja", () => {
  it("normalizuje dijakritiku i razmake", () => {
    expect(normaliseHeader("  Datum  Početka ")).toBe("datum pocetka");
    expect(normaliseHeader("Registarska oznaka")).toBe("registarska oznaka");
    expect(normaliseHeader("Šifra")).toBe("sifra");
  });

  it("tekst sa razmacima ostaje tekst, ne broj", () => {
    expect(toText("  Amina ")).toBe("Amina");
    expect(toText(12)).toBe("12");
  });
});

describe("demo-podaci fajlovi i formatirani prazni redovi (Dio 2b)", () => {
  it("čita tri sintetička fajla iz v2/docs/demo-podaci i ne broji prazne redove šablona", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "..", "..", "docs", "demo-podaci");
    const expected: Record<string, number> = {
      "radnici-popunjeno.xlsx": 29,
      "masine-popunjeno.xlsx": 19,
      "rokovi-popunjeno.xlsx": 100,
    };
    for (const [file, rows] of Object.entries(expected)) {
      const parsed = await parseWorkbook(readFileSync(join(dir, file)), file);
      expect("code" in parsed).toBe(false);
      if (!("code" in parsed)) expect(parsed.rows).toHaveLength(rows);
    }
  });

  it("500 formatiranih praznih redova šablona nisu ni podaci ni greške", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Radnici");
    sheet.addRow(["Ime", "Prezime", "Datum početka"]);
    sheet.addRow(["Test", "Testić", "2024-01-15"]);
    // Šablon s unaprijed formatiranim praznim redovima (brojčani format + ivice).
    for (let row = 3; row <= 502; row += 1) {
      for (let col = 1; col <= 3; col += 1) {
        const cell = sheet.getCell(row, col);
        cell.numFmt = "dd.mm.yyyy";
        cell.border = { top: { style: "thin" } };
      }
    }
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseWorkbook(bytes, "sablon.xlsx");
    expect("code" in parsed).toBe(false);
    if (!("code" in parsed)) {
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.rows[0]?.rowNumber).toBe(2);
    }
  });
});

describe("normalizacija đ (Dio 2)", () => {
  it("ODREĐENO se normalizuje u odredjeno, ne odre eno", () => {
    expect(normaliseHeader("ODREĐENO")).toBe("odredjeno");
    expect(normaliseHeader("Đuro Đaković")).toBe("djuro djakovic");
  });
});

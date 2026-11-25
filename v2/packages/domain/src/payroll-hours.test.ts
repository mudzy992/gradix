/**
 * Zlatni testovi Modula 7: klasifikacija sati.
 *
 * Tvrdnja koja mora vrijediti za SVAKI slučaj: zbir po kategorijama = ukupni sati. Ako se to
 * pokvari, obračun se ne može kontrolisati — a greška je nevidljiva jer svaka kategorija
 * pojedinačno izgleda ispravno.
 */
import { describe, expect, it } from "vitest";
import {
  classifyDay,
  nightWindows,
  parseClock,
  sumCategoryHours,
  totalHours,
  isSundayDate,
  WEEK_START_ISO,
  type CategoryHours,
  type PayrollRules,
} from "./payroll-hours";

const RULES: PayrollRules = {
  nightFrom: "22:00",
  nightTo: "06:00",
  overtimeBasis: "DAILY",
  overtimeDailyThreshold: 8,
  overtimeWeeklyThreshold: null,
  weekStartIso: WEEK_START_ISO.MON!,
};

/* `24:00` je granica dana, a ne vrijeme na satu — `parseClock` ga (ispravno) odbija, pa se ovdje
   prevodi u 1440. Bez toga bi svaki segment do ponoći imao `NaN` minute i test bi mjerio ništa. */
const at = (hhmm: string) => (hhmm === "24:00" ? 1440 : parseClock(hhmm)!);
const slice = (from: string, to: string) => ({ from: at(from), to: at(to) });

function work(slices: ReturnType<typeof slice>[], extra: Partial<Parameters<typeof classifyDay>[0]> = {}) {
  return classifyDay(
    {
      slices,
      dayKind: "WORK",
      isPaidHoliday: false,
      isSunday: false,
      ...extra,
    },
    RULES,
  );
}

function expectConsistent(hours: CategoryHours, expectedTotal: number) {
  expect(totalHours(hours)).toBeCloseTo(expectedTotal, 6);
  for (const key of ["HOLIDAY", "SUNDAY", "NIGHT", "OVERTIME", "REGULAR"] as const) {
    expect(hours[key]).toBeGreaterThanOrEqual(0);
  }
}

describe("obračun sati — prioritet kategorija", () => {
  it("praznik koji je i nedjelja ide u PRAZNIK, ne u obje", () => {
    const hours = work([slice("07:00", "15:00")], { isPaidHoliday: true, isSunday: true });
    expect(hours.HOLIDAY).toBe(8);
    expect(hours.SUNDAY).toBe(0);
    expectConsistent(hours, 8);
  });

  it("nedjelja ide u NEDJELJA i preko praga (prag se ne mjeri po kategoriji)", () => {
    const hours = work([slice("06:00", "18:00")], { isSunday: true });
    expect(hours.SUNDAY).toBe(12);
    expect(hours.OVERTIME).toBe(0);
    expectConsistent(hours, 12);
  });

  it("neradni praznik bez is_paid NE mijenja kategoriju", () => {
    const hours = work([slice("07:00", "15:00")], { isPaidHoliday: false });
    expect(hours.HOLIDAY).toBe(0);
    expect(hours.REGULAR).toBe(8);
  });

  it("noćni sat preko praga je NOĆNI, ne PREKOVREMENI — sat se ne plaća dvaput", () => {
    // 14:00–24:00 = 10 h; noćni 22:00–24:00 = 2 h; prekovremeni preko 8 h = 2 h.
    const hours = work([slice("14:00", "24:00")], {});
    expect(hours.NIGHT).toBe(2);
    expect(hours.OVERTIME).toBe(2);
    expect(hours.REGULAR).toBe(6);
    // 2 + 2 + 6 = 10: prekovremeni sat NIJE uzet iz noćnih sati.
    expectConsistent(hours, 10);
  });

  it("noćni sat iznad praga ostaje NOĆNI (prioritet), prekovremeni se ne udvostručuje", () => {
    // 20:00–24:00 = 4 h, sve noćno (22:00–24:00 su 2 h, 20:00–22:00 su redovni).
    const hours = work([slice("20:00", "24:00")]);
    expect(hours.NIGHT).toBe(2);
    expect(hours.REGULAR).toBe(2);
    expect(hours.OVERTIME).toBe(0);
    expectConsistent(hours, 4);
  });

  it("dnevni prag: 10 h rada = 8 redovnih + 2 prekovremena", () => {
    const hours = work([slice("07:00", "17:00")]);
    expect(hours.REGULAR).toBe(8);
    expect(hours.OVERTIME).toBe(2);
    expectConsistent(hours, 10);
  });

  it("dva segmenta od po 4 h ipak daju prekovremeni preko 8 h ukupno", () => {
    const hours = work([slice("06:00", "10:00"), slice("11:00", "15:00")]);
    expect(hours.REGULAR).toBe(8);
    expect(hours.OVERTIME).toBe(0);
    expectConsistent(hours, 8);

    const longer = work([slice("06:00", "11:00"), slice("12:00", "17:00")]);
    expect(longer.REGULAR).toBe(8);
    expect(longer.OVERTIME).toBe(2);
    expectConsistent(longer, 10);
  });

  it("praznik uzima SVE sate dana, i prekovremene", () => {
    const hours = work([slice("06:00", "18:00")], { isPaidHoliday: true });
    expect(hours.HOLIDAY).toBe(12);
    expect(hours.OVERTIME).toBe(0);
    expectConsistent(hours, 12);
  });
});

describe("obračun sati — noćni prozor i ponoć", () => {
  it("prozor preko ponoći daje dva intervala", () => {
    expect(nightWindows({ nightFrom: "22:00", nightTo: "06:00" })).toEqual([
      { from: 1320, to: 1440 },
      { from: 0, to: 360 },
    ]);
  });

  it("prozor unutar istog dana daje jedan interval", () => {
    expect(nightWindows({ nightFrom: "00:00", nightTo: "05:00" })).toEqual([
      { from: 0, to: 300 },
    ]);
  });

  it("nema prozora kad firma nije definisala noćni rad — nema izmišljenog 22:00", () => {
    expect(nightWindows({ nightFrom: null, nightTo: null })).toEqual([]);
    const hours = classifyDay(
      {
        slices: [slice("20:00", "24:00")],
        dayKind: "WORK",
        isPaidHoliday: false,
        isSunday: false,
      },
      { ...RULES, nightFrom: null, nightTo: null },
    );
    expect(hours.NIGHT).toBe(0);
    expectConsistent(hours, 4);
  });

  it("segment 22:00–02:00 ne gubi minutu (4 h rada, 4 h noćnih)", () => {
    /* Dan se reže po ponoći: 22:00–24:00 je dio prvog dana, 00:00–02:00 drugog. Bez cijepanja
       prozora na dva intervala drugi dan ne bi imao nijedan noćni sat. */
    const firstDay = work([slice("22:00", "24:00")]);
    const secondDay = work([{ from: 0, to: at("02:00") }]);
    expect(firstDay.NIGHT).toBe(2);
    expect(secondDay.NIGHT).toBe(2);
    expectConsistent(firstDay, 2);
    expectConsistent(secondDay, 2);
    expect(totalHours(firstDay) + totalHours(secondDay)).toBe(4);
  });

  it("minuta tačno na granici prozora pripada noćnim satima", () => {
    expect(nightWindows({ nightFrom: "22:00", nightTo: "06:00" })[0]).toEqual({
      from: 1320,
      to: 1440,
    });
    const hours = work([{ from: 1319, to: 1321 }]);
    expect(hours.NIGHT).toBeCloseTo(1 / 60, 6);
  });

  it("neispravan format sata se ne tumači kao 00:00", () => {
    expect(parseClock("25:00")).toBeNull();
    expect(parseClock("22:60")).toBeNull();
    expect(parseClock("")).toBeNull();
    expect(parseClock(null)).toBeNull();
    expect(nightWindows({ nightFrom: "nije vrijeme", nightTo: "06:00" })).toEqual([]);
  });
});

describe("obračun sati — prekovremeni osnov", () => {
  it("sedmični osnov daje drugu raspodjelu od dnevnog", () => {
    const weekly: PayrollRules = {
      ...RULES,
      overtimeBasis: "WEEKLY",
      overtimeWeeklyThreshold: 40,
    };
    // Ponedjeljak 10 h: uz dnevni osnov 2 h prekovremenog; uz sedmični (0 h prije) sve redovno.
    const daily = work([slice("07:00", "17:00")]);
    const weeklyDay = classifyDay(
      { slices: [slice("07:00", "17:00")], dayKind: "WORK", isPaidHoliday: false, isSunday: false, priorWeekMinutes: 0 },
      weekly,
    );
    expect(daily.OVERTIME).toBe(2);
    expect(weeklyDay.OVERTIME).toBe(0);
    expect(weeklyDay.REGULAR).toBe(10);
  });

  it("sedmični osnov: peti dan prelazi prag od 40 h", () => {
    const weekly: PayrollRules = { ...RULES, overtimeBasis: "WEEKLY", overtimeWeeklyThreshold: 40 };
    const hours = classifyDay(
      {
        slices: [slice("07:00", "15:00")],
        dayKind: "WORK",
        isPaidHoliday: false,
        isSunday: false,
        priorWeekMinutes: 36 * 60,
      },
      weekly,
    );
    expect(hours.REGULAR).toBe(4);
    expect(hours.OVERTIME).toBe(4);
    expectConsistent(hours, 8);
  });

  it("prag nula ne postoji kao tiho pravilo: bez praga nema prekovremenih", () => {
    const broken: PayrollRules = { ...RULES, overtimeBasis: "WEEKLY", overtimeWeeklyThreshold: null };
    const hours = classifyDay(
      { slices: [slice("07:00", "20:00")], dayKind: "WORK", isPaidHoliday: false, isSunday: false, priorWeekMinutes: 0 },
      broken,
    );
    expect(hours.OVERTIME).toBe(0);
    expectConsistent(hours, 13);
  });
});

describe("obračun sati — izostanci", () => {
  it.each(["SICK", "VACATION", "PAID_LEAVE", "UNPAID_LEAVE", "NO_SHOW", "HOLIDAY"] as const)(
    "%s nema sate (izostanak nije rad)",
    (dayKind) => {
      const hours = classifyDay(
        { slices: [slice("07:00", "15:00")], dayKind, isPaidHoliday: false, isSunday: false },
        RULES,
      );
      expect(totalHours(hours)).toBe(0);
    },
  );
});

describe("obračun sati — pomoćne funkcije", () => {
  it("nedjelja se prepoznaje bez obzira na početak sedmice", () => {
    expect(isSundayDate("2026-11-22")).toBe(true); // nedjelja
    expect(isSundayDate("2026-11-23")).toBe(false); // ponedjeljak
    for (const [code, iso] of Object.entries(WEEK_START_ISO)) {
      expect(iso).toBeGreaterThanOrEqual(1);
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("suma kategorija = suma sati i poslije sabiranja više dana", () => {
    const day1 = work([slice("07:00", "17:00")]);
    const day2 = work([slice("22:00", "24:00")]);
    const sum = sumCategoryHours([day1, day2]);
    expect(totalHours(sum)).toBeCloseTo(12, 6);
    expect(sum.OVERTIME).toBe(2);
    expect(sum.NIGHT).toBe(2);
  });
});

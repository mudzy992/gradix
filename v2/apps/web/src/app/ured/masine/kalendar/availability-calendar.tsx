"use client";

/**
 * F4 (Modul 5 §1.7.28) — kalendar zauzetosti mašina, mjesec × mašina.
 *
 * Ćelija je dan; dan sa dodjelom nosi oznaku projekta, prazna ćelija znači „slobodno". To je
 * namjerno: posebna tabela slobodnog vremena bila bi druga istina koja se raziđe sa dodjelama
 * pri svakoj izmjeni.
 *
 * Pristupačnost: `DataTable` (prava `<table>` sa `caption` i zaglavljima), a svaka ćelija nosi
 * PUN tekst („12.11. — P-1 (iznimka)") — boja nikad nije jedini nosilac značenja. Sirov `<table>`
 * u `app/**` je zabranjen lint pravilom, i to je dobro: katalog komponenti drži jedno ponašanje.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiCall } from "@/api-client";
import { Alert, Button, DataTable, EmptyState, Input, Skeleton, Stack } from "@/components/ui/index";

type Slot = {
  machine_id: string;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  from_date: string;
  to_date: string | null;
  override_id: string | null;
};

type MachineRow = {
  machine_id: string;
  machine_code: string;
  machine_name: string;
  slots: Slot[];
};

type CalendarRow = { machine_id: string; label: string; slots: Slot[] };

/** `YYYY-MM-DD` bez vremenske zone — kalendar je kalendarski, ne trenutak. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthBounds(month: string): { from: string; to: string; days: string[] } {
  const [year, monthPart] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year!, monthPart! - 1, 1));
  const last = new Date(Date.UTC(year!, monthPart!, 0));
  const days: string[] = [];
  for (let day = new Date(first); day <= last; day = new Date(day.getTime() + 86_400_000)) {
    days.push(isoDate(day));
  }
  return { from: isoDate(first), to: isoDate(last), days };
}

export function AvailabilityCalendar({ initialMonth }: { initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [rows, setRows] = useState<MachineRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { from, to } = monthBounds(month);
    const res = await apiCall<{ machines: MachineRow[] }>(
      `/api/calendar/availability?from=${from}&to=${to}`,
    );
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setRows(res.data.machines);
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  const { days } = useMemo(() => monthBounds(month), [month]);

  const data = useMemo<CalendarRow[]>(
    () =>
      (rows ?? []).map((machine) => ({
        machine_id: machine.machine_id,
        label: `${machine.machine_code} — ${machine.machine_name}`,
        slots: machine.slots,
      })),
    [rows],
  );

  /*
   * Kolone se grade iz dana u mjesecu. Zaglavlje je samo dan („12.") jer je mjesec u naslovu
   * iznad tabele — ponavljanje mjeseca u 31 zaglavlju bi tabelu učinilo nečitljivom.
   */
  const columns = useMemo(() => {
    const base: Parameters<typeof DataTable<CalendarRow>>[0]["columns"] = [
      { key: "machine", header: "Mašina", cell: (row) => row.label },
    ];
    for (const day of days) {
      base.push({
        key: day,
        header: `${Number(day.slice(8, 10))}.`,
        cell: (row) => {
          const slot = row.slots.find(
            (entry) => entry.from_date <= day && (entry.to_date === null || entry.to_date >= day),
          );
          if (!slot) return <span className="gx-muted">slobodno</span>;
          /*
           * Tekst, ne samo boja: „P-1" / „P-1 *" je čitljivo i bez palete. Iznimka nosi zvjezdicu
           * jer preklapanje pokriveno odobrenjem nije greška — ali mora biti vidljivo.
           */
          return <span className="gx-chip">{slot.project_code ?? "projekat"}{slot.override_id ? " *" : ""}</span>;
        },
      });
    }
    return base;
  }, [days]);

  if (error) return <Alert tone="error" role="alert">{error}</Alert>;

  return (
    <Stack gap="var(--space-4)">
      <div className="gx-inline-flex">
        <Input
          label="Mjesec"
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        />
        <Button variant="secondary" onClick={() => void load()}>Osvježi</Button>
      </div>
      <p className="gx-muted">
        Ćelija sa oznakom projekta = mašina je zauzeta. „slobodno" je prazna ćelija. Zvjezdica `*`
        označava preklapanje pokriveno odobrenom iznimkom (Modul 2).
      </p>
      {rows === null ? (
        <Skeleton rows={4} />
      ) : (
        <DataTable
          caption="Zauzetost mašina po danima"
          rows={data}
          rowKey={(row) => row.machine_id}
          columns={columns}
          empty={(
            <EmptyState
              title="Nema aktivnih mašina"
              description="Kalendar prikazuje samo aktivne mašine — dodajte mašinu u inventar."
            />
          )}
        />
      )}
    </Stack>
  );
}

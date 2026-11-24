"use client";

/**
 * Sedmični pregled radnih dana: tabela radnik × dan (spec 03 §1.5.22).
 *
 * Odluke koje ekran sprovodi:
 *  - **Prazna ćelija nije nula.** Ćelija bez dana je prazna; dan sa izostankom ima oznaku vrste
 *    dana. Da su oboje „0 h“, ured ne bi razlikovao „nije radio“ od „nema podataka“.
 *  - **Suma je po radniku, ne po firmi.** Vlasnik čita red po red; zbir firme ne odgovara ni na
 *    jedno pitanje koje ured stvarno postavlja.
 *  - **Za provjeru je oznaka, ne boja.** `reviewState` piše riječima (`FORGOTTEN`, `UNKNOWN_END`),
 *    jer crvena tačka bez teksta ne kaže šta treba uraditi.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import { Alert, Button, Card, Chip, DataTable, EmptyState, FilterBar, Inline, Select, Stack } from "@/components/ui/index";
import type { WeekView } from "@/server/workday-timer-service";
import { ABSENCE_KINDS, DAY_KIND_LABEL, dayName, dayNumber, minutesLabel, weekDays } from "./week-labels";
import { downloadCsv } from "./week-csv";

type Cell = WeekView["rows"][number]["days"][string];

const REVIEW_LABEL: Record<string, string> = {
  OK: "",
  FORGOTTEN: "Zaboravljen",
  UNKNOWN_END: "Kraj nepoznat",
  OPEN_TODAY: "Otvoren",
};

export function WeekClient({
  week,
  projects,
  canConfirm,
}: {
  week: WeekView;
  projects: { id: string; code: string; name: string }[];
  canConfirm: boolean;
}) {
  const router = useRouter();
  const days = useMemo(() => weekDays(week.weekStart), [week.weekStart]);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [workDate, setWorkDate] = useState(days[0]!);
  const [busy, setBusy] = useState(false);

  async function confirmBulk() {
    setBusy(true);
    const result = await apiCall<{ confirmed: number; skipped: { workerName: string; reason: string }[] }>(
      "/api/workdays/confirm-bulk",
      jsonBody({ projectId, workDate }),
    );
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return;
    }
    const { confirmed, skipped } = result.data;
    setMessage({
      tone: skipped.length > 0 ? "error" : "success",
      text:
        skipped.length > 0
          ? `Potvrđeno ${confirmed}. Preskočeno ${skipped.length}: ${skipped
              .map((entry) => `${entry.workerName} (${entry.reason})`)
              .join("; ")}`
          : `Potvrđeno ${confirmed} dana.`,
    });
    router.refresh();
  }

  return (
    <Stack gap="lg">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      {canConfirm ? (
        <Card>
          <FilterBar>
            <Select label="Projekat" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} · {project.name}
                </option>
              ))}
            </Select>
            <Select label="Datum" value={workDate} onChange={(event) => setWorkDate(event.target.value)}>
              {days.map((day) => (
                <option key={day} value={day}>
                  {dayName(day)} {dayNumber(day)}
                </option>
              ))}
            </Select>
            <Button onClick={() => void confirmBulk()} disabled={busy || !projectId}>
              Potvrdi sve na projektu
            </Button>
          </FilterBar>
          <p className="mt-2 text-sm opacity-70">
            Potvrđuju se samo dani radnika koji na taj datum imaju dodjelu na izabranom projektu.
            Ostali se preskaču i piše ko je preskočen i zašto.
          </p>
        </Card>
      ) : null}

      <Card>
        {week.rows.length === 0 ? (
          <EmptyState title="Nema radnika" description="U sedmici nema nijednog aktivnog radnika sa danima." />
        ) : (
          <DataTable
            caption={`Radni dani za sedmicu od ${week.weekStart}`}
            rowKey={(row) => row.workerId}
            rows={week.rows}
            columns={[
              { key: "worker", header: "Radnik", cell: (row) => row.workerName },
              ...days.map((day) => ({
                key: day,
                header: `${dayName(day)} ${dayNumber(day)}`,
                numeric: true,
                cell: (row: WeekView["rows"][number]) => <DayCell cell={row.days[day]} />,
              })),
              {
                key: "total",
                header: "Ukupno",
                numeric: true,
                cell: (row) => minutesLabel(row.totalMinutes),
              },
            ]}
          />
        )}
      </Card>

      <Card>
        <Inline gap="lg">
          {/*
            CSV se pravi NA KLIJENTU iz već učitanih podataka: izvoz koji zove server ponovo bi
            mogao dati drugu sliku od one koju korisnik gleda, a to je najgori mogući izvoz.
          */}
          <Button variant="quiet" onClick={() => downloadCsv(week)}>
            Preuzmi CSV
          </Button>
          <span className="text-sm">
            Ukupno u sedmici: <strong>{minutesLabel(week.totals.minutes)}</strong>
          </span>
          <span className="text-sm">
            Sukobi sa terena: <strong>{week.openConflicts}</strong>
          </span>
          {Object.entries(week.totals.byDayKind)
            .filter(([, minutes]) => minutes > 0)
            .map(([kind, minutes]) => (
              <Chip key={kind} tone="hollow">
                {DAY_KIND_LABEL[kind] ?? kind}: {minutesLabel(minutes)}
              </Chip>
            ))}
        </Inline>
      </Card>
    </Stack>
  );
}

function DayCell({ cell }: { cell: Cell | undefined }) {
  if (!cell) return <span className="opacity-30">—</span>;
  const absence = ABSENCE_KINDS.has(cell.dayKind);
  const review = REVIEW_LABEL[cell.reviewState];
  return (
    <Stack gap="var(--space-1)">
      <span>{absence ? DAY_KIND_LABEL[cell.dayKind] : minutesLabel(cell.minutes)}</span>
      {/* Oznaka za provjeru je TEKST: boja sama ne kaže šta ured treba da uradi. */}
      {review ? <span className="text-xs opacity-70">{review}</span> : null}
    </Stack>
  );
}

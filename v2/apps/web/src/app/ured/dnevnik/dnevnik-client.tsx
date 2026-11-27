"use client";

/**
 * F9 — lista dnevnika: traka nepotpisanih dana, filter po projektu i otvaranje dana.
 *
 * Zašto traka iznad liste: pitanje nije „koji dan postoji“, nego „koji dan nije potpisan“. Zato
 * nestali potpisi stoje prvi, sa datumom i brojem dana zakašnjenja — to je jedina stavka na ovom
 * ekranu koja traži radnju danas.
 *
 * Otvaranje dana ide u jednom zahtjevu: `POST /api/site-diaries` vraća postojeći dan sa kodom
 * `DIARY_EXISTS`, pa šef nastavlja isti dan umjesto da dobije grešku koju ne razumije (§1.1/1).
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import { Alert, Button, Card, DataTable, EmptyState, Field, FilterBar, Inline, Input, SelectField as Select, Stack, StatusDot } from "@/components/ui/index";
import type { SiteDiaryListItem } from "@gradix/contracts";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Nacrt",
  SIGNED: "Potpisan",
  LOCKED: "Zaključan",
};

const WEATHER_LABEL: Record<string, string> = {
  CLEAR: "vedro",
  CLOUDY: "oblačno",
  RAIN: "kiša",
  SNOW: "snijeg",
  WIND: "vjetar",
  FROST: "mraz",
  HEAT: "vrućina",
};

const daysLate = (date: string): number =>
  Math.max(0, Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000));

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}.`;
}

export function DnevnikClient({
  initialDiaries,
  unsigned,
  projects,
  caps,
}: {
  initialDiaries: SiteDiaryListItem[];
  unsigned: SiteDiaryListItem[];
  projects: { id: string; code: string; name: string }[];
  caps: { canManage: boolean; canSign: boolean };
}) {
  const router = useRouter();
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [diaryDate, setDiaryDate] = useState(new Date().toISOString().slice(0, 10));
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () =>
      initialDiaries.filter((diary) => {
        if (projectFilter && diary.projectId !== projectFilter) return false;
        if (statusFilter && diary.status !== statusFilter) return false;
        return true;
      }),
    [initialDiaries, projectFilter, statusFilter],
  );

  const openDay = useCallback(async () => {
    if (!projectId) {
      setNotice({ tone: "error", text: "Izaberite projekat." });
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await apiCall<{ outcome: string; id: string; code?: string; message?: string }>(
      "/api/site-diaries",
      jsonBody({ projectId, diaryDate }),
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    /* Postojeći dan: ista radnja, drugi ishod — čovjek ide na taj dan, ne na grešku. */
    if (result.data.code === "DIARY_EXISTS") {
      setNotice({ tone: "info", text: "Dan je već otvoren — nastavljate postojeći zapis." });
    }
    router.push(`/ured/dnevnik/${result.data.id}`);
  }, [diaryDate, projectId, router]);

  return (
    <Stack gap="var(--space-5)">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {unsigned.length > 0 ? (
        <Alert tone="warning" role="alert">
          {unsigned.length === 1
            ? "Jedan dan čeka potpis: "
            : `${unsigned.length} dana čekaju potpis: `}
          {unsigned
            .slice(0, 5)
            .map((diary) => `${formatDate(diary.diaryDate)} (${diary.projectCode}, ${daysLate(diary.diaryDate)} d)`)
            .join(", ")}
          {unsigned.length > 5 ? " …" : ""}
          . Dnevnik bez potpisa nije dokaz o izvedenim radovima.
        </Alert>
      ) : null}

      {caps.canManage ? (
        <Card>
          <Inline gap="var(--space-4)">
            <Field label="Projekat" htmlFor="dnevnik-projekat">
              <Select
                id="dnevnik-projekat"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} — {project.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Datum" htmlFor="dnevnik-datum">
              <Input
                id="dnevnik-datum"
                type="date"
                value={diaryDate}
                onChange={(event) => setDiaryDate(event.target.value)}
              />
            </Field>
            <Button onClick={openDay} disabled={busy}>
              {busy ? "Otvaram…" : "Otvori dan"}
            </Button>
          </Inline>
        </Card>
      ) : null}

      <FilterBar>
        <Field label="Projekat" htmlFor="filter-projekat">
          <Select
            id="filter-projekat"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="">Svi projekti</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Stanje" htmlFor="filter-stanje">
          <Select
            id="filter-stanje"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">Sva stanja</option>
            <option value="DRAFT">Nacrt</option>
            <option value="SIGNED">Potpisan</option>
            <option value="LOCKED">Zaključan</option>
          </Select>
        </Field>
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState
          title="Nema dnevnika za taj filter"
          description={
            caps.canManage
              ? "Otvorite dan iznad — radnici, mašine i ture se pune sami iz evidencije."
              : "Kad šef otvori dan, zapis će se pojaviti ovdje."
          }
        />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          caption="Dnevnici građenja"
          columns={[
            {
              key: "dan",
              header: "Dan",
              cell: (row) => (
                <Stack gap="var(--space-1)">
                  <strong>{formatDate(row.diaryDate)}</strong>
                  <span className="gx-page-sub">
                    {row.projectCode} — {row.projectName}
                  </span>
                </Stack>
              ),
            },
            {
              key: "stanje",
              header: "Stanje",
              cell: (row) => (
                <StatusDot
                  tone={row.status === "LOCKED" ? "ok" : row.status === "SIGNED" ? "warn" : "danger"}
                  label={STATUS_LABEL[row.status] ?? row.status}
                />
              ),
            },
            {
              key: "teren",
              header: "Teren",
              cell: (row) => (
                <span className="gx-page-sub">
                  {row.workersCount} radnika · {row.machinesCount} mašina
                </span>
              ),
            },
            {
              key: "vrijeme",
              header: "Vrijeme",
              cell: (row) => (
                <span className="gx-page-sub">
                  {row.weather ? (WEATHER_LABEL[row.weather] ?? row.weather) : "—"}
                  {row.workedHours ? ` · ${row.workedHours} h` : ""}
                </span>
              ),
            },
            {
              key: "zastoji",
              header: "Zastoji",
              cell: (row) => <span className="gx-page-sub">{Number(row.delaysHours) > 0 ? `${row.delaysHours} h` : "—"}</span>,
            },
            {
              key: "potpis",
              header: "Potpis",
              cell: (row) => <span className="gx-page-sub">{row.signedName ?? "—"}</span>,
            },
            {
              key: "akcija",
              header: "",
              cell: (row) => (
                <Button variant="quiet" onClick={() => router.push(`/ured/dnevnik/${row.id}`)}>
                  Otvori
                </Button>
              ),
            },
          ]}
        />
      )}
    </Stack>
  );
}

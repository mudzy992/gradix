"use client";

/**
 * F9 — HSE ekran: stanje, incidenti, prijava, mjere koje kasne i statistika.
 *
 * Redoslijed je redoslijed RIZIKA: aktivna zabrana rada prva (zaustavlja gradilište), pa mjere
 * koje kasne (zakonski rok), pa otvoreni incidenti, pa statistika. Statistika je na kraju jer se
 * čita kad je posao pod kontrolom — ne dok gori.
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Card, Checkbox, DataTable, Field, FilterBar, FormGrid, Inline, Input, Select,
  SectionTitle, Stack, Stat, StatusDot, Tabs, Dialog, Textarea,
} from "@/components/ui/index";
import type { HseStats } from "@gradix/contracts";
import { filterIncidents } from "./hse-filter";

type IncidentRow = {
  id: string;
  kind: string;
  severity: string;
  status: string;
  occurredAt: string;
  projectId: string | null;
  projectName: string | null;
  description: string;
  lostDays: number;
  reportableToAuthority: boolean;
  reportObligationId: string | null;
  openActions: number;
  overdueActions: number;
};

export type HseAttention = {
  overdueActions: number;
  openIncidents: number;
  prohibition: { id: string; inspectedAt: string; authorityName: string | null } | null;
  unsignedDiaries: number;
};

const KIND_LABEL: Record<string, string> = {
  ACCIDENT: "Nesreća",
  NEAR_MISS: "NEAR_MISS (skoro pa)",
  PROPERTY_DAMAGE: "Šteta na imovini",
  ENVIRONMENTAL: "Okoliš",
  OCCUPATIONAL_ILLNESS: "Bolest u vezi s radom",
};

const SEVERITY_LABEL: Record<string, string> = {
  MINOR: "Laka",
  MODERATE: "Umjerena",
  SEVERE: "Teška",
  FATAL: "Smrtna",
};

const STATUS_LABEL: Record<string, string> = {
  REPORTED: "Prijavljen",
  INVESTIGATING: "U istrazi",
  ACTIONS_OPEN: "Otvorene mjere",
  CLOSED: "Zatvoren",
};

const percent = (value: number | null): string => (value === null ? "—" : `${value.toFixed(1)}%`);

export function HseClient({
  initialIncidents,
  stats,
  attention,
  today,
  caps,
}: {
  initialIncidents: IncidentRow[];
  stats: HseStats;
  attention: HseAttention | null;
  today: string;
  caps: { canReport: boolean; canInvestigate: boolean; canManageTrainings: boolean; canExport?: boolean };
}) {
  const router = useRouter();
  const [tab,setTab] = useState("incidents");
  const [reportOpen,setReportOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [report, setReport] = useState({
    kind: "NEAR_MISS",
    severity: "MINOR",
    occurredAt: "",
    description: "",
    immediateAction: "",
    lostDays: "0",
    reportableToAuthority: false,
  });
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => filterIncidents(initialIncidents,kindFilter,statusFilter), [initialIncidents,kindFilter,statusFilter]);

  const submitReport = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall<{ id: string; obligationId: string | null }>(
      "/api/hse/incidents",
      jsonBody({
        kind: report.kind,
        severity: report.severity,
        occurredAt: report.occurredAt ? new Date(report.occurredAt).toISOString() : new Date().toISOString(),
        description: report.description,
        immediateAction: report.immediateAction || null,
        lostDays: Number(report.lostDays || "0"),
        reportableToAuthority: report.reportableToAuthority,
      }),
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({
      tone: "success",
      text: result.data.obligationId
        ? "Incident je prijavljen i otvorena je obaveza prijave inspekciji (rok 3 dana)."
        : "Incident je prijavljen.",
    });
    setReportOpen(false);
    setReport((current) => ({ ...current, description: "", immediateAction: "", lostDays: "0" }));
    router.refresh();
  }, [report, router]);

  return (
    <Stack gap="var(--space-5)">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {attention?.prohibition ? (
        <Alert tone="error" role="alert">
          <strong>ZABRANA RADA je aktivna</strong> — nalaz {attention.prohibition.authorityName ?? "inspekcije"} od{" "}
          {attention.prohibition.inspectedAt.slice(0, 10)}. Rad na gradilištu je zaustavljen do podizanja zabrane.
        </Alert>
      ) : null}

      <Inline>
        <Stat label="Otvoreni incidenti" value={attention ? String(attention.openIncidents) : "—"} hint="Svi osim CLOSED" />
        <Stat label="Mjere koje kasne" value={attention ? String(attention.overdueActions) : "—"} hint="due_on < danas, status OPEN" />
        <Stat label="Dnevnik bez potpisa" value={attention ? String(attention.unsignedDiaries) : "—"} hint="stariji od 2 dana" />
        <Stat
          label="LTIFR (godina)"
          value={stats.ltifr === null ? "—" : stats.ltifr.toFixed(2)}
          hint={`na ${stats.workedHours.toFixed(0)} odrađenih sati`}
        />
      </Inline>

      <Tabs label="HSE pregled" active={tab} onChange={setTab} tabs={[{key:"incidents",label:"Incidenti"},{key:"statistics",label:"Statistika"}]} />
      {tab === "statistics" ? <Card>
        <SectionTitle hint="Sve je izračun iz incidenta i sati — nijedan broj nije upisan rukom">
          Statistika {stats.from} — {stats.to}
        </SectionTitle>
        <Inline>
          <StatusDot tone="muted" label={`Incidenti: ${stats.incidents}`} />
          <StatusDot tone="warn" label={`NEAR_MISS: ${stats.nearMisses}`} />
          <StatusDot tone="danger" label={`Izgubljeni dani: ${stats.lostDays}`} />
          <StatusDot tone="muted" label={`Mjere na vrijeme: ${percent(stats.actions.onTimeRate)}`} />
          <StatusDot tone="muted" label={`Obuke: ${stats.trainings.count} (toolbox ${stats.trainings.toolbox})`} />
          <StatusDot tone="muted" label={`Prisustva: ${stats.trainings.attendees}`} />
        </Inline>
        <p className="gx-page-sub">
          LTIFR = (ozljede sa izgubljenim danima × 1 000 000) / odrađeni sati. NEAR_MISS se broji odvojeno —
          sabran sa nesrećama izgubi preventivni signal.
        </p>
        <a className="gx-link" href={`/api/hse/report/pdf?from=${stats.from}&to=${stats.to}`}>Preuzmi HSE izvještaj (PDF)</a>
      </Card> : null}

      {caps.canReport && reportOpen ? (
        <Dialog title="Prijavi incident" trapFocus onClose={()=>{if(!busy)setReportOpen(false);}}>
        {notice?.tone === "error" ? <Alert tone="error" role="alert">{notice.text}</Alert> : null}
        <Card>
          <SectionTitle hint="Prijava ne blokira ništa — evidentira i pokreće mjere">Prijavi incident</SectionTitle>
          <FormGrid>
            <Field label="Vrsta" htmlFor="inc-vrsta">
              <Select
                id="inc-vrsta"
                value={report.kind}
                onChange={(event) => setReport((current) => ({ ...current, kind: event.target.value }))}
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Težina" htmlFor="inc-tezina">
              <Select
                id="inc-tezina"
                value={report.severity}
                onChange={(event) => setReport((current) => ({ ...current, severity: event.target.value }))}
              >
                {Object.entries(SEVERITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Kada" htmlFor="inc-kada">
              <Input
                id="inc-kada"
                type="datetime-local"
                value={report.occurredAt}
                onChange={(event) => setReport((current) => ({ ...current, occurredAt: event.target.value }))}
              />
            </Field>
            <Field label="Izgubljeni dani" htmlFor="inc-dani">
              <Input
                id="inc-dani"
                value={report.lostDays}
                onChange={(event) => setReport((current) => ({ ...current, lostDays: event.target.value }))}
                disabled={report.kind === "NEAR_MISS"}
              />
            </Field>
          </FormGrid>
          <Field label="Šta se dogodilo" htmlFor="inc-opis">
            <Textarea
              id="inc-opis"
              rows={3}
              value={report.description}
              onChange={(event) => setReport((current) => ({ ...current, description: event.target.value }))}
            />
          </Field>
          <Field label="Šta je odmah urađeno" htmlFor="inc-mjera">
            <Textarea
              id="inc-mjera"
              rows={2}
              value={report.immediateAction}
              onChange={(event) => setReport((current) => ({ ...current, immediateAction: event.target.value }))}
            />
          </Field>
          <Inline>
            <Checkbox
              label="Prijavljuje se inspekciji rada (pravi obavezu sa rokom)"
              checked={report.reportableToAuthority}
              onChange={(event) => setReport((current) => ({ ...current, reportableToAuthority: event.target.checked }))}
            />
            <Button
              variant="primary"
              onClick={submitReport}
              disabled={busy || report.description.trim().length < 5}
            >
              {busy ? "Prijavljujem…" : "Prijavi incident"}
            </Button>
          </Inline>
        </Card>
        </Dialog>
      ) : null}

      {tab === "incidents" ? <>
      {caps.canReport ? <Button variant="primary" onClick={()=>setReportOpen(true)}>+ Prijavi incident</Button> : null}
      <FilterBar>
        <Field label="Vrsta" htmlFor="filter-vrsta">
          <Select id="filter-vrsta" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
            <option value="">Sve vrste</option>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Stanje" htmlFor="filter-status">
          <Select id="filter-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Sva stanja</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      {caps.canExport ? <p><a className="gx-link" href={`/api/hse/incidents/export?${new URLSearchParams({kind:kindFilter,status:statusFilter})}`}>Preuzmi CSV prikazanih incidenata</a> · Prikaz i izvoz obuhvataju najviše 200 incidenata.</p> : null}
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        caption="Incidenti"
        emptyText="Nema incidenata za taj filter. NEAR_MISS se takođe prijavljuje — to je najkorisniji preventivni signal."
        columns={[
          {
            key: "događaj",
            header: "Događaj",
            cell: (row) => (
              <Stack gap="var(--space-1)">
                <strong>{KIND_LABEL[row.kind] ?? row.kind}</strong>
                <span className="gx-page-sub">{row.occurredAt.slice(0, 16).replace("T", " ")}</span>
              </Stack>
            ),
          },
          {
            key: "tezina",
            header: "Težina",
            cell: (row) => (
              <StatusDot
                tone={row.severity === "FATAL" || row.severity === "SEVERE" ? "danger" : row.severity === "MODERATE" ? "warn" : "muted"}
                label={SEVERITY_LABEL[row.severity] ?? row.severity}
              />
            ),
          },
          { key: "stanje", header: "Stanje", cell: (row) => STATUS_LABEL[row.status] ?? row.status },
          { key: "projekat", header: "Projekat", cell: (row) => row.projectName ?? "—" },
          {
            key: "mjere",
            header: "Mjere",
            cell: (row) => (
              <span className="gx-page-sub">
                {row.openActions} otvoreno{row.overdueActions > 0 ? ` · ${row.overdueActions} kasni` : ""}
              </span>
            ),
          },
          {
            key: "prijava",
            header: "Prijava inspekciji",
            cell: (row) => (row.reportableToAuthority
              ? <StatusDot tone={row.reportObligationId ? "warn" : "danger"} label={row.reportObligationId ? "obaveza otvorena" : "bez obaveze"} />
              : "—"),
          },
          {
            key: "akcija",
            header: "",
            cell: (row) => (
              <Button variant="quiet" onClick={() => router.push(`/ured/hse/${row.id}`)}>Otvori</Button>
            ),
          },
        ]}
      />

      </> : null}
      {!caps.canInvestigate ? (
        <Alert tone="info">
          Istraga, mjere i zatvaranje incidenta traže dozvolu `hse.investigate` — prijava je pravo svakoga.
          Današnji datum: {today}.
        </Alert>
      ) : null}
    </Stack>
  );
}

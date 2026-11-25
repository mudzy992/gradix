"use client";

/**
 * F9 — inspekcije i nalazi (§1.5).
 *
 * `PROHIBITION` bez `prohibitionLiftedAt` je AKTIVNA zabrana: crvena traka iznad svega i jedina
 * radnja koja je istaknuta je „podigni zabranu“ sa obaveznim razlogom. Nalaz se ne može urediti
 * naknadno — zabrana nestaje samo kroz taj zapis, sa tragom ko je i zašto.
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Card, DataTable, Field, FilterBar, FormGrid, Inline, Input, SectionTitle,
  Select, Stack, StatusDot, Textarea,
} from "@/components/ui/index";

export type InspectionRow = {
  id: string;
  kind: string;
  authorityName: string | null;
  inspectedAt: string;
  inspectorName: string | null;
  summary: string | null;
  result: string;
  prohibitionLiftedAt: string | null;
  projectName: string | null;
  openActions: number;
};

const RESULT_LABEL: Record<string, string> = {
  PASS: "Bez nalaza",
  MINOR_FINDINGS: "Manji nalazi",
  MAJOR_FINDINGS: "Teži nalazi",
  PROHIBITION: "Zabrana rada",
};

const KIND_LABEL: Record<string, string> = {
  INTERNAL: "Interna",
  EXTERNAL: "Eksterna",
  AUTHORITY: "Državni organ",
};

export function InspekcijeClient({
  initial,
  caps,
}: {
  initial: InspectionRow[];
  caps: { canInvestigate: boolean };
}) {
  const router = useRouter();
  const [resultFilter, setResultFilter] = useState("");
  const [form, setForm] = useState({
    kind: "AUTHORITY",
    authorityName: "",
    inspectedAt: "",
    inspectorName: "",
    summary: "",
    result: "PASS",
  });
  const [lift, setLift] = useState({ id: "", note: "" });
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const activeProhibition = useMemo(
    () => initial.find((row) => row.result === "PROHIBITION" && row.prohibitionLiftedAt === null) ?? null,
    [initial],
  );
  const rows = useMemo(
    () => initial.filter((row) => !resultFilter || row.result === resultFilter),
    [initial, resultFilter],
  );

  const run = useCallback(
    async (key: string, request: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
      setBusy(key);
      setNotice(null);
      const outcome = await request();
      setBusy(null);
      if (!outcome.ok) {
        setNotice({ tone: "error", text: outcome.message ?? "Radnja nije uspjela." });
        return;
      }
      setNotice({ tone: "success", text: success });
      router.refresh();
    },
    [router],
  );

  const record = () =>
    run("record", () => apiCall("/api/hse/inspections", jsonBody({
      kind: form.kind,
      authorityName: form.authorityName || null,
      inspectedAt: form.inspectedAt ? new Date(form.inspectedAt).toISOString() : new Date().toISOString(),
      inspectorName: form.inspectorName || null,
      summary: form.summary || null,
      result: form.result,
    })), form.result === "PROHIBITION"
      ? "Inspekcija je evidentirana i vlasnik je odmah obaviješten o zabrani rada."
      : "Inspekcija je evidentirana.");

  const liftProhibition = () =>
    run("lift", () => apiCall("/api/hse/inspections", {
      method: "PATCH",
      ...jsonBody({ id: lift.id, note: lift.note }),
    }), "Zabrana rada je podignuta.");

  return (
    <Stack gap="var(--space-5)">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {activeProhibition ? (
        <Alert tone="error" role="alert">
          <strong>AKTIVNA ZABRANA RADA</strong> — {activeProhibition.authorityName ?? KIND_LABEL[activeProhibition.kind]} od{" "}
          {activeProhibition.inspectedAt.slice(0, 10)} na {activeProhibition.projectName ?? "gradilištu"}. Rad stoji dok se
          zabrana izričito ne podigne.
        </Alert>
      ) : null}

      <FilterBar>
        <Field label="Nalaz" htmlFor="filter-nalaz">
          <Select id="filter-nalaz" value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
            <option value="">Svi nalazi</option>
            {Object.entries(RESULT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        caption="Inspekcije"
        emptyText="Nema evidentiranih inspekcija."
        columns={[
          { key: "kada", header: "Kada", cell: (row) => row.inspectedAt.slice(0, 10) },
          {
            key: "organ",
            header: "Ko",
            cell: (row) => (
              <Stack gap="var(--space-1)">
                <span>{row.authorityName ?? KIND_LABEL[row.kind] ?? row.kind}</span>
                <span className="gx-page-sub">{row.inspectorName ?? "—"}</span>
              </Stack>
            ),
          },
          { key: "projekat", header: "Projekat", cell: (row) => row.projectName ?? "—" },
          {
            key: "nalaz",
            header: "Nalaz",
            cell: (row) => (
              <StatusDot
                tone={row.result === "PROHIBITION" ? "danger" : row.result === "PASS" ? "ok" : "warn"}
                label={RESULT_LABEL[row.result] ?? row.result}
              />
            ),
          },
          {
            key: "zabrana",
            header: "Zabrana",
            cell: (row) =>
              row.result !== "PROHIBITION"
                ? "—"
                : row.prohibitionLiftedAt
                  ? `podignuta ${row.prohibitionLiftedAt.slice(0, 10)}`
                  : "TRAJE",
          },
          { key: "mjere", header: "Otvorene mjere", numeric: true, cell: (row) => String(row.openActions) },
          {
            key: "akcija",
            header: "",
            cell: (row) =>
              caps.canInvestigate && row.result === "PROHIBITION" && row.prohibitionLiftedAt === null ? (
                <Button variant="quiet" onClick={() => setLift({ id: row.id, note: "" })}>Podigni zabranu</Button>
              ) : null,
          },
        ]}
      />

      {lift.id && caps.canInvestigate ? (
        <Card>
          <SectionTitle hint="Zabrana nestaje samo ovim zapisom, sa tragom ko je i zašto">
            Podizanje zabrane rada
          </SectionTitle>
          <Field label="Razlog podizanja (bar 5 znakova)" htmlFor="zabrana-razlog">
            <Textarea
              id="zabrana-razlog"
              rows={2}
              value={lift.note}
              onChange={(event) => setLift((current) => ({ ...current, note: event.target.value }))}
            />
          </Field>
          <Inline>
            <Button
              variant="primary"
              onClick={liftProhibition}
              disabled={busy === "lift" || lift.note.trim().length < 5}
            >
              Potvrdi podizanje
            </Button>
            <Button variant="quiet" onClick={() => setLift({ id: "", note: "" })}>Odustani</Button>
          </Inline>
        </Card>
      ) : null}

      {caps.canInvestigate ? (
        <Card>
          <SectionTitle hint="Zabrana rada odmah obavještava vlasnika">Evidentiraj inspekciju</SectionTitle>
          <FormGrid>
            <Field label="Vrsta" htmlFor="ins-vrsta">
              <Select
                id="ins-vrsta"
                value={form.kind}
                onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Naziv organa" htmlFor="ins-organ" hint="Obavezno za državni organ.">
              <Input
                id="ins-organ"
                value={form.authorityName}
                onChange={(event) => setForm((current) => ({ ...current, authorityName: event.target.value }))}
              />
            </Field>
            <Field label="Kada" htmlFor="ins-kada">
              <Input
                id="ins-kada"
                type="datetime-local"
                value={form.inspectedAt}
                onChange={(event) => setForm((current) => ({ ...current, inspectedAt: event.target.value }))}
              />
            </Field>
            <Field label="Inspektor" htmlFor="ins-inspektor">
              <Input
                id="ins-inspektor"
                value={form.inspectorName}
                onChange={(event) => setForm((current) => ({ ...current, inspectorName: event.target.value }))}
              />
            </Field>
            <Field label="Nalaz" htmlFor="ins-nalaz">
              <Select
                id="ins-nalaz"
                value={form.result}
                onChange={(event) => setForm((current) => ({ ...current, result: event.target.value }))}
              >
                {Object.entries(RESULT_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <Field label="Sažetak nalaza" htmlFor="ins-sazetak">
            <Textarea
              id="ins-sazetak"
              rows={2}
              value={form.summary}
              onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))}
            />
          </Field>
          <Button
            variant="primary"
            onClick={record}
            disabled={busy === "record" || (form.kind === "AUTHORITY" && form.authorityName.trim().length < 2)}
          >
            Evidentiraj
          </Button>
        </Card>
      ) : null}
    </Stack>
  );
}

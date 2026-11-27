"use client";

/**
 * F9 — obuke i toolbox razgovori (§1.4/18-22).
 *
 * Unos je namjerno kratak: vrsta (toolbox je najčešći), tema, trajanje i označena ekipa. Potpis se
 * NE izmišlja ovdje — server upisuje `signatureName` = ime radnika i `signedAt` = sada, uz audit.
 * Ekran to kaže riječima, da niko ne pomisli da je checkbox dovoljan.
 *
 * Prisustvo se bira označavanjem ekipe jednim dodirom (checkbox lista), jer je to jedini način da
 * 20 ljudi uđe u zapis za pola minute.
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Card, Checkbox, DataTable, Field, FormGrid, Inline, Input, SectionTitle, SelectField as Select,
  Stack, StatusDot, Textarea,
} from "@/components/ui/index";

export type TrainingRow = {
  id: string;
  kind: string;
  title: string;
  topic: string | null;
  heldAt: string;
  durationMinutes: number | null;
  location: string | null;
  projectName: string | null;
  attendees: number;
};

const KIND_LABEL: Record<string, string> = {
  INDUCTION: "Uvodna obuka",
  TOOLBOX: "Toolbox razgovor",
  TASK_INSTRUCTION: "Uputa za zadatak",
  CERTIFICATION: "Certifikacija",
  DRILL: "Vježba evakuacije",
};

export function ObukeClient({
  initial,
  workers,
  caps,
}: {
  initial: TrainingRow[];
  workers: { id: string; full_name: string }[];
  caps: { canManage: boolean };
}) {
  const router = useRouter();
  const [kindFilter, setKindFilter] = useState("");
  const [form, setForm] = useState({
    kind: "TOOLBOX",
    title: "",
    topic: "",
    heldAt: "",
    durationMinutes: "15",
    location: "",
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => initial.filter((row) => !kindFilter || row.kind === kindFilter),
    [initial, kindFilter],
  );

  const toggle = (workerId: string) =>
    setSelected((current) =>
      current.includes(workerId) ? current.filter((id) => id !== workerId) : [...current, workerId]);

  const submit = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    const signedAt = new Date().toISOString();
    const result = await apiCall("/api/hse/trainings", jsonBody({
      kind: form.kind,
      title: form.title || form.topic || KIND_LABEL[form.kind] || form.kind,
      topic: form.topic || null,
      heldAt: form.heldAt ? new Date(form.heldAt).toISOString() : signedAt,
      location: form.location || null,
      durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
      attendees: selected.map((workerId) => ({
        workerId,
        signatureName: workers.find((worker) => worker.id === workerId)?.full_name ?? "radnik",
        signedAt,
      })),
    }));
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({ tone: "success", text: "Obuka je evidentirana sa potpisima prisutnih." });
    setSelected([]);
    setForm((current) => ({ ...current, title: "", topic: "" }));
    router.refresh();
  }, [form, router, selected, workers]);

  return (
    <Stack gap="var(--space-5)">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <Inline>
        <Field label="Vrsta" htmlFor="filter-obuka">
          <Select id="filter-obuka" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
            <option value="">Sve vrste</option>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
      </Inline>

      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        caption="Održane obuke"
        emptyText="Nema evidentiranih obuka."
        columns={[
          { key: "kada", header: "Kada", cell: (row) => row.heldAt.slice(0, 16).replace("T", " ") },
          {
            key: "obuka",
            header: "Obuka",
            cell: (row) => (
              <Stack gap="var(--space-1)">
                <strong>{row.title}</strong>
                <span className="gx-page-sub">{row.topic ?? KIND_LABEL[row.kind] ?? row.kind}</span>
              </Stack>
            ),
          },
          {
            key: "vrsta",
            header: "Vrsta",
            cell: (row) => (
              <StatusDot tone={row.kind === "TOOLBOX" ? "muted" : row.kind === "CERTIFICATION" ? "ok" : "warn"} label={KIND_LABEL[row.kind] ?? row.kind} />
            ),
          },
          { key: "trajanje", header: "Trajanje", numeric: true, cell: (row) => (row.durationMinutes === null ? "—" : `${row.durationMinutes} min`) },
          { key: "prisutni", header: "Potpisa", numeric: true, cell: (row) => String(row.attendees) },
          { key: "projekat", header: "Projekat", cell: (row) => row.projectName ?? "—" },
        ]}
      />

      {caps.canManage ? (
        <Card>
          <SectionTitle hint="Potpis radnika se upisuje uz audit — checkbox nije potpis">
            Nova obuka / toolbox
          </SectionTitle>
          <FormGrid>
            <Field label="Vrsta" htmlFor="obuka-vrsta">
              <Select
                id="obuka-vrsta"
                value={form.kind}
                onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Naslov" htmlFor="obuka-naslov">
              <Input
                id="obuka-naslov"
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              />
            </Field>
            <Field label="Kada" htmlFor="obuka-kada">
              <Input
                id="obuka-kada"
                type="datetime-local"
                value={form.heldAt}
                onChange={(event) => setForm((current) => ({ ...current, heldAt: event.target.value }))}
              />
            </Field>
            <Field label="Trajanje (min)" htmlFor="obuka-trajanje">
              <Input
                id="obuka-trajanje"
                value={form.durationMinutes}
                onChange={(event) => setForm((current) => ({ ...current, durationMinutes: event.target.value }))}
              />
            </Field>
            <Field label="Lokacija" htmlFor="obuka-lokacija">
              <Input
                id="obuka-lokacija"
                value={form.location}
                onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
              />
            </Field>
          </FormGrid>
          <Field
            label="Tema"
            htmlFor="obuka-tema"
            hint={form.kind === "TOOLBOX" ? "Toolbox traži temu (bar 3 znaka) — bez teme to je sastanak bez zapisa." : undefined}
          >
            <Textarea
              id="obuka-tema"
              rows={2}
              value={form.topic}
              onChange={(event) => setForm((current) => ({ ...current, topic: event.target.value }))}
            />
          </Field>

          <fieldset className="gx-field">
            <legend className="gx-field__label">Prisutni ({selected.length})</legend>
            <div className="gx-check-grid">
              {workers.map((worker) => (
                <Checkbox
                  key={worker.id}
                  label={worker.full_name}
                  checked={selected.includes(worker.id)}
                  onChange={() => toggle(worker.id)}
                />
              ))}
            </div>
          </fieldset>

          <Button
            variant="primary"
            onClick={submit}
            disabled={busy || selected.length === 0
              || (form.kind === "TOOLBOX" && form.topic.trim().length < 3)}
          >
            {busy ? "Upisujem…" : "Evidentiraj obuku"}
          </Button>
        </Card>
      ) : null}
    </Stack>
  );
}

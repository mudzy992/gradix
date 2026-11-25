"use client";

/**
 * F9 — ručni unos i količine dnevnika (izdvojeno iz `dnevnik-detail-client` zbog `max-lines`).
 *
 * Isti razlog kao kod zaglavlja ekrana: forma ne zna ništa o potpisu ni revizijama, samo o onome
 * što čovjek tipka. Zato je zasebna komponenta — mijenja se kad se mijenjaju polja, a ne kad se
 * mijenja tok dokumenta.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Button, Card, DataTable, Field, FormGrid, Input, SectionTitle, Select, Stack, Textarea,
} from "@/components/ui/index";
import type { SiteDiaryDetail } from "@gradix/contracts";

const WEATHER_OPTIONS = [
  { value: "CLEAR", label: "Vedro" },
  { value: "CLOUDY", label: "Oblačno" },
  { value: "RAIN", label: "Kiša" },
  { value: "SNOW", label: "Snijeg" },
  { value: "WIND", label: "Vjetar" },
  { value: "FROST", label: "Mraz" },
  { value: "HEAT", label: "Vrućina" },
] as const;

const DELAY_OPTIONS = [
  { value: "RAIN", label: "Kiša" },
  { value: "SNOW", label: "Snijeg" },
  { value: "WIND", label: "Vjetar" },
  { value: "FROST", label: "Mraz" },
  { value: "SUBCONTRACTOR", label: "Podizvođač" },
  { value: "MATERIAL", label: "Materijal" },
  { value: "PERMIT", label: "Dozvola" },
  { value: "OTHER", label: "Ostalo" },
] as const;

export function DnevnikForm({
  detail,
  editable,
  onNotice,
}: {
  detail: SiteDiaryDetail;
  editable: boolean;
  onNotice: (notice: { tone: "success" | "error" | "info"; text: string } | null) => void;
}) {
  const router = useRouter();
  const diary = detail.diary;
  const [form, setForm] = useState({
    weather: diary.weather ?? "",
    temperatureC: diary.temperatureC ?? "",
    workedHours: diary.workedHours ?? "",
    description: diary.description ?? "",
    visitors: diary.visitors ?? "",
    events: diary.events ?? "",
  });
  const [item, setItem] = useState({ description: "", unit: "m3", quantity: "" });
  const [delay, setDelay] = useState({ kind: "RAIN", fromAt: "", toAt: "", hours: "", note: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const run = async (key: string, request: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
    setBusy(key);
    onNotice(null);
    const result = await request();
    setBusy(null);
    if (!result.ok) {
      onNotice({ tone: "error", text: result.message ?? "Radnja nije uspjela." });
      return;
    }
    onNotice({ tone: "success", text: success });
    router.refresh();
  };

  const saveDraft = () =>
    run("save", () => apiCall(`/api/site-diaries/${diary.id}`, {
      method: "PATCH",
      ...jsonBody({
        weather: form.weather || null,
        temperatureC: form.temperatureC || null,
        workedHours: form.workedHours || null,
        description: form.description || null,
        visitors: form.visitors || null,
        events: form.events || null,
      }),
    }), "Nacrt je sačuvan.");

  const addItem = async () => {
    await run("item", () => apiCall(`/api/site-diaries/${diary.id}/items`, jsonBody({
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
    })), "Količina je dodana.");
    setItem((current) => ({ ...current, description: "", quantity: "" }));
  };

  const removeItem = (itemId: string) =>
    run(`item-${itemId}`, () => apiCall(`/api/site-diaries/${diary.id}/items/${itemId}`, { method: "DELETE" }),
      "Stavka je uklonjena.");

  const addDelay = () =>
    run("delay", () => apiCall(`/api/site-diaries/${diary.id}/delays`, jsonBody({
      kind: delay.kind,
      fromAt: delay.fromAt ? new Date(delay.fromAt).toISOString() : "",
      toAt: delay.toAt ? new Date(delay.toAt).toISOString() : "",
      hours: delay.hours,
      note: delay.note || null,
    })), "Zastoj je upisan.");

  return (
    <Stack gap="var(--space-5)">
      <Card>
        <SectionTitle hint="Ono što sistem ne zna">Ručni unos</SectionTitle>
        <FormGrid>
          <Field label="Vrijeme" htmlFor="dnevnik-vrijeme">
            <Select id="dnevnik-vrijeme" value={form.weather} onChange={set("weather")} disabled={!editable}>
              <option value="">—</option>
              {WEATHER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Temperatura (°C)" htmlFor="dnevnik-temperatura">
            <Input id="dnevnik-temperatura" value={form.temperatureC} onChange={set("temperatureC")} disabled={!editable} />
          </Field>
          <Field label="Radni sati na gradilištu" htmlFor="dnevnik-sati">
            <Input id="dnevnik-sati" value={form.workedHours} onChange={set("workedHours")} disabled={!editable} />
          </Field>
          <Field label="Posjetioci" htmlFor="dnevnik-posjetioci">
            <Input id="dnevnik-posjetioci" value={form.visitors} onChange={set("visitors")} disabled={!editable} />
          </Field>
        </FormGrid>
        <Field label="Opis izvedenih radova" htmlFor="dnevnik-opis">
          <Textarea id="dnevnik-opis" value={form.description} onChange={set("description")} disabled={!editable} rows={3} />
        </Field>
        <Field label="Posebni događaji" htmlFor="dnevnik-dogadjaji">
          <Textarea id="dnevnik-dogadjaji" value={form.events} onChange={set("events")} disabled={!editable} rows={2} />
        </Field>
        {editable ? (
          <Button variant="primary" onClick={saveDraft} disabled={busy === "save"}>
            {busy === "save" ? "Spašavam…" : "Sačuvaj nacrt"}
          </Button>
        ) : null}
      </Card>

      <Card>
        <SectionTitle hint="BOQ stavka odmah uvećava izvršenje predmjera">Količine izvedenih radova</SectionTitle>
        <DataTable
          rows={detail.items}
          rowKey={(row) => row.id}
          caption="Količine izvedenih radova"
          emptyText="Nema unesenih količina."
          columns={[
            { key: "opis", header: "Stavka", cell: (row) => row.description },
            { key: "kolicina", header: "Količina", numeric: true, cell: (row) => `${row.quantity} ${row.unit}` },
            { key: "izvor", header: "Izvor", cell: (row) => row.source },
            {
              key: "napredak",
              header: "Predmjer",
              cell: (row) =>
                row.boqQuantityPlanned
                  ? `${row.boqQuantityExecuted ?? "0"} / ${row.boqQuantityPlanned}`
                  : "—",
            },
            ...(editable
              ? [{
                key: "brisi",
                header: "",
                cell: (row: SiteDiaryDetail["items"][number]) => (
                  <Button variant="quiet" onClick={() => removeItem(row.id)} disabled={busy === `item-${row.id}`}>
                    Ukloni
                  </Button>
                ),
              }]
              : []),
          ]}
        />
        {editable ? (
          <FormGrid>
            <Field label="Opis" htmlFor="stavka-opis">
              <Input
                id="stavka-opis"
                value={item.description}
                onChange={(event) => setItem((current) => ({ ...current, description: event.target.value }))}
              />
            </Field>
            <Field label="Jedinica" htmlFor="stavka-jedinica">
              <Input
                id="stavka-jedinica"
                value={item.unit}
                onChange={(event) => setItem((current) => ({ ...current, unit: event.target.value }))}
              />
            </Field>
            <Field label="Količina" htmlFor="stavka-kolicina">
              <Input
                id="stavka-kolicina"
                value={item.quantity}
                onChange={(event) => setItem((current) => ({ ...current, quantity: event.target.value }))}
              />
            </Field>
            <Button onClick={addItem} disabled={busy === "item"}>Dodaj količinu</Button>
          </FormGrid>
        ) : null}
      </Card>

      <Card>
        <SectionTitle hint="Zbir je dokaz za produženje roka i veže se na TIME aneks">Zastoji</SectionTitle>
        <DataTable
          rows={detail.delays}
          rowKey={(row) => row.id}
          caption="Zastoji"
          emptyText="Nema evidentiranih zastoja."
          columns={[
            { key: "vrsta", header: "Vrsta", cell: (row) => DELAY_OPTIONS.find((option) => option.value === row.kind)?.label ?? row.kind },
            { key: "od", header: "Od", cell: (row) => row.fromAt.slice(11, 16) },
            { key: "do", header: "Do", cell: (row) => row.toAt.slice(11, 16) },
            { key: "sati", header: "Sati", numeric: true, cell: (row) => row.hours },
            { key: "aneks", header: "Aneks", cell: (row) => (row.extensionDays === null ? "—" : `+${row.extensionDays} d`) },
            { key: "napomena", header: "Napomena", cell: (row) => row.note ?? "—" },
          ]}
        />
        {editable ? (
          <FormGrid>
            <Field label="Vrsta" htmlFor="zastoj-vrsta">
              <Select
                id="zastoj-vrsta"
                value={delay.kind}
                onChange={(event) => setDelay((current) => ({ ...current, kind: event.target.value }))}
              >
                {DELAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Od" htmlFor="zastoj-od">
              <Input
                id="zastoj-od"
                type="datetime-local"
                value={delay.fromAt}
                onChange={(event) => setDelay((current) => ({ ...current, fromAt: event.target.value }))}
              />
            </Field>
            <Field label="Do" htmlFor="zastoj-do">
              <Input
                id="zastoj-do"
                type="datetime-local"
                value={delay.toAt}
                onChange={(event) => setDelay((current) => ({ ...current, toAt: event.target.value }))}
              />
            </Field>
            <Field label="Sati" htmlFor="zastoj-sati">
              <Input
                id="zastoj-sati"
                value={delay.hours}
                onChange={(event) => setDelay((current) => ({ ...current, hours: event.target.value }))}
              />
            </Field>
            <Button onClick={addDelay} disabled={busy === "delay"}>Upiši zastoj</Button>
          </FormGrid>
        ) : null}
      </Card>

      {detail.revisions.length > 0 ? (
        <Card>
          <SectionTitle>Revizije</SectionTitle>
          <ul>
            {detail.revisions.map((entry) => (
              <li key={entry.id}>
                {entry.createdAt.slice(0, 16).replace("T", " ")} — {entry.authorName}: {entry.reason}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}


    </Stack>
  );
}

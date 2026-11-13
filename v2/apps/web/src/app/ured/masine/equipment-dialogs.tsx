"use client";

/** Dijalozi mašina: forma, upis brojila i kategorije — Dialog obrazac iz kataloga (footer). */
import { useState } from "react";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import { formatDateTime, formatNumber, meterUnit } from "@/format";
import {
  Alert, Button, Dialog, Input, Mono, Select,
} from "@/components/ui/index";
import type { CategoryRow, MachineRow } from "./equipment-shared";

const EMPTY_FORM = {
  code: "",
  name: "",
  categoryId: "",
  make: "",
  model: "",
  serialNo: "",
  plate: "",
  year: "",
  ownership: "OWN",
  meterValue: "",
};

type FormState = typeof EMPTY_FORM;

const fromMachine = (machine: MachineRow): FormState => ({
  code: machine.code,
  name: machine.name,
  categoryId: machine.categoryId,
  make: machine.make ?? "",
  model: machine.model ?? "",
  serialNo: machine.serialNo ?? "",
  plate: machine.plate ?? "",
  year: machine.year === null ? "" : String(machine.year),
  ownership: machine.ownership,
  meterValue: machine.meterValue === null ? "" : String(machine.meterValue),
});

export function MachineDialog({
  machine,
  categories,
  returnFocusTo,
  onSaved,
  onClose,
}: {
  machine: MachineRow | null;
  categories: CategoryRow[];
  returnFocusTo: HTMLElement | null;
  onSaved: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(machine ? fromMachine(machine) : EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const category = categories.find((candidate) => candidate.id === form.categoryId);
  // Vrsta brojila se ne bira: dolazi iz kategorije. Kad brojilo već ima vrijednost, servis ne
  // dozvoljava ni promjenu vrste — ekran to ne nudi umjesto da prijavi grešku poslije.
  const meterLocked = Boolean(machine && machine.meterValue !== null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        categoryId: form.categoryId || categories[0]?.id || "",
        make: form.make.trim() || null,
        model: form.model.trim() || null,
        serialNo: form.serialNo.trim() || null,
        plate: form.plate.trim().toUpperCase() || null,
        year: form.year.trim() === "" ? null : Number(form.year),
        ownership: form.ownership,
        ...(machine && meterLocked ? {} : { meter: category?.meter }),
        ...(machine ? {} : { meterValue: form.meterValue.trim() === "" ? null : Number(form.meterValue) }),
      };
      const result = machine
        ? await apiCall<{ machine: MachineRow }>(`/api/equipment/${machine.id}`, patchBody(payload))
        : await apiCall<{ machine: MachineRow }>("/api/equipment", jsonBody(payload));

      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onSaved(
        machine ? `${payload.code}: izmjene su sačuvane.` : `${payload.code} je dodana u inventar.`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={machine ? `Izmjena ${machine.code}` : "Nova mašina"}
      hint="Kategorija određuje da li se brojilo mjeri u satima ili kilometrima."
      returnFocusTo={returnFocusTo}
      onClose={onClose}
      wide
    >
      <form onSubmit={save} className="gx-stack">
        {error ? (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        ) : null}

        {categories.length === 0 ? (
          <Alert tone="warning">
            Prvo dodajte kategoriju — bez nje mašina ne zna kako se mjeri brojilo.
          </Alert>
        ) : null}

        <div className="gx-cols">
          <Input label="Inventarska oznaka" hint="2–20 znakova: velika slova, brojevi, crtica."id="machine-code"
              value={form.code}
              onChange={(event) => set("code", event.target.value)} />
          <Input label="Naziv"id="machine-name"
              value={form.name}
              onChange={(event) => set("name", event.target.value)} />
        </div>

        <div className="gx-cols">
          <Select label="Kategorija" hint={category ? `Brojilo: ${meterUnit(category.meter)}` : "Kategorija nosi vrstu brojila."} id="machine-category"
              value={form.categoryId}
              onChange={(event) => set("categoryId", event.target.value)}
              required
            >
              <option value="">— izaberite —</option>
              {categories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          <Select label="Vlasništvo"id="machine-ownership"
              value={form.ownership}
              onChange={(event) => set("ownership", event.target.value)}
            >
              <option value="OWN">Svoje</option>
              <option value="RENT">Najam</option>
            </Select>
        </div>

        <div className="gx-cols">
          <Input label="Marka"id="machine-make"
              value={form.make}
              onChange={(event) => set("make", event.target.value)} />
          <Input label="Model"id="machine-model"
              value={form.model}
              onChange={(event) => set("model", event.target.value)} />
        </div>

        <div className="gx-cols">
          <Input label="Serijski broj"id="machine-serial"
              value={form.serialNo}
              onChange={(event) => set("serialNo", event.target.value)} />
          <Input label="Registarska oznaka"id="machine-plate"
              value={form.plate}
              onChange={(event) => set("plate", event.target.value)} />
        </div>

        <div className="gx-cols">
          <Input label="Godina"id="machine-year"
              type="number"
              inputMode="numeric"
              min={1900}
              max={2100}
              value={form.year}
              onChange={(event) => set("year", event.target.value)} />
          {meterLocked ? (
            <Input label="Brojilo" hint="Vrsta se ne mijenja dok brojilo ima vrijednost."id="machine-meter-locked"
                value={`${formatNumber(machine?.meterValue ?? null)} ${meterUnit(machine?.meter ?? "HOURS")}`}
                readOnly
                disabled />
          ) : (
            <Input label="Početno stanje brojila"id="machine-meter-value"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.1"
                value={form.meterValue}
              onChange={(event) => set("meterValue", event.target.value)} />
          )}
        </div>

        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Otkaži
          </Button>
          <Button type="submit" variant="primary" fullWidthOnMobile disabled={saving || categories.length === 0}>
            {saving ? "Čuvam…" : machine ? "Sačuvaj izmjene" : "Dodaj mašinu"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Upis brojila. Namjerno odvojeno od forme mašine: to je radnja koja se radi svaki dan
 * (rukovalac na terenu), a ne izmjena inventara.
 *
 * Manja vrijednost nije „greška koju treba zaobići“ nego pitanje: servis vraća `CONFLICT`, pa
 * korisnik potvrđuje da je upisana vrijednost bila pogrešna. Bez potvrde se ništa ne mijenja.
 */
export function MeterDialog({
  machine,
  returnFocusTo,
  onSaved,
  onClose,
}: {
  machine: MachineRow;
  returnFocusTo: HTMLElement | null;
  onSaved: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(correct: boolean) {
    const parsed = Number(value.replace(",", "."));
    if (value.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
      setError("Upišite broj (npr. 1234,5).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiCall<{ machine: MachineRow }>(
        `/api/equipment/${machine.id}/meter`,
        patchBody({ value: parsed, ...(correct ? { correct: true } : {}) }),
      );
      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // Poruka servisa već kaže i staru i novu vrijednost — ne prepisujem je svojom.
          setConflict(result.message);
          return;
        }
        setError(result.message);
        return;
      }
      await onSaved(
        `${machine.code}: brojilo je ${formatNumber(parsed)} ${meterUnit(machine.meter)}.`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={`Brojilo · ${machine.code}`}
      hint={`${machine.name} · ${machine.categoryName}`}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
    >
      <div className="gx-stack gx-mt-5">
        <p className="gx-page-sub">
          Upisano:{" "}
          <Mono>
            {machine.meterValue === null
              ? "—"
              : `${formatNumber(machine.meterValue)} ${meterUnit(machine.meter)}`}
          </Mono>
          {machine.meterUpdatedAt ? ` · ${formatDateTime(machine.meterUpdatedAt)}` : ""}
        </p>

        {error ? (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        ) : null}

        {conflict ? (
          <Alert tone="warning" role="alert">
            {conflict}
          </Alert>
        ) : null}

        <Input label="Novo stanje" id="meter-value" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />

        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Otkaži
          </Button>
          {conflict ? (
            <Button variant="danger" fullWidthOnMobile disabled={saving} onClick={() => void submit(true)}>
              {saving ? "Upisujem…" : "Potvrdi ispravku"}
            </Button>
          ) : (
            <Button variant="primary" fullWidthOnMobile disabled={saving} onClick={() => void submit(false)}>
              {saving ? "Upisujem…" : "Upiši brojilo"}
            </Button>
          )}
        </div>

        <p className="gx-page-sub">
          Ovdje je samo trenutno stanje. Historija očitanja dolazi u R5.
        </p>
      </div>
    </Dialog>
  );
}

/**
 * Kategorije — podatak firme. Forma je u istoj kartici kao lista, jer se dodaje najviše par
 * kategorija godišnje; poseban ekran bi bio prazan hod.
 */

"use client";

/**
 * Mašine i vozila — lista, forma, kategorije i trenutna vrijednost brojila.
 *
 * Pravila koja ekran sprovodi:
 *  - **Kategorija je podatak firme, ne šifra u kodu** (odluka vlasnika). Zato se nova kategorija
 *    dodaje ovdje, a ne migracijom; brojilo (sati/km) dolazi iz kategorije.
 *  - **Brojilo je samo trenutna vrijednost.** Historija očitanja je R5 — ekran to i kaže, da se
 *    ne očekuje kriva kroz vrijeme.
 *  - **Manja vrijednost traži izričitu ispravku.** Servis vraća `CONFLICT`; ekran tada pita
 *    „jest li siguran“ i pošalje `correct: true`. Nikad se ne prepisuje tiho.
 *  - Deaktivacija umjesto brisanja: mašina ostaje u istoriji zapisa i radnih naloga.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EquipmentCategory as CategoryRow, Machine as MachineApi } from "@gradix/contracts";

/**
 * Ekran koristi isti tip kao ugovor (`Machine`), samo pod kraćim imenom; `MachineRow` u servisu
 * je serverski red i nema šta da traži u klijentu.
 */
type MachineRow = MachineApi;
import { apiCall, jsonBody, patchBody } from "@/api-client";
import { formatDateTime, formatNumber, meterUnit, ownershipLabel } from "@/format";
import { Dialog } from "@/components/dialog";
import {
  Alert,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Icon,
  Mono,
  SectionTitle,
  Skeleton,
  inputClass,
} from "@/components/ui";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; machines: MachineRow[]; categories: CategoryRow[] };

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

export default function EquipmentClient({ canManage }: { canManage: boolean }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState<{ machine: MachineRow | null; returnTo: HTMLElement | null } | null>(null);
  const [meterFor, setMeterFor] = useState<{ machine: MachineRow; returnTo: HTMLElement | null } | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const [machines, categories] = await Promise.all([
      apiCall<{ machines: MachineRow[] }>("/api/equipment"),
      apiCall<{ categories: CategoryRow[] }>("/api/equipment-categories"),
    ]);
    if (!machines.ok) {
      setState({ kind: "error", message: machines.message });
      return;
    }
    if (!categories.ok) {
      setState({ kind: "error", message: categories.message });
      return;
    }
    setState({ kind: "ready", machines: machines.data.machines, categories: categories.data.categories });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const machines = state.kind === "ready" ? state.machines : [];
  const categories = state.kind === "ready" ? state.categories : [];

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return machines.filter((machine) => {
      if (!showInactive && !machine.isActive) return false;
      if (categoryFilter && machine.categoryId !== categoryFilter) return false;
      if (needle.length === 0) return true;
      return `${machine.code} ${machine.name} ${machine.plate ?? ""} ${machine.make ?? ""} ${machine.model ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [machines, filter, categoryFilter, showInactive]);

  const inactiveCount = machines.filter((machine) => !machine.isActive).length;

  async function toggleActive(machine: MachineRow) {
    const result = await apiCall<{ machine: MachineRow }>(
      `/api/equipment/${machine.id}`,
      patchBody({
        code: machine.code,
        name: machine.name,
        categoryId: machine.categoryId,
        isActive: !machine.isActive,
      }),
    );
    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return;
    }
    setMessage({
      tone: "success",
      text: machine.isActive
        ? `${machine.code} je deaktiviran. Ostaje u istoriji.`
        : `${machine.code} je ponovo aktivan.`,
    });
    await load();
  }

  return (
    <div>
      <div className="gx-page-head">
        <div className="gx-page-head__text">
          <h1 className="gx-page-title">Mašine i vozila</h1>
          <p className="gx-page-sub">
            Inventar firme, kategorije i trenutno stanje brojila. Historija očitanja dolazi u R5.
          </p>
        </div>
        {canManage ? (
          <div className="gx-page-head__actions">
            <Button onClick={() => setCategoriesOpen(true)}>Kategorije</Button>
            <Button
              variant="primary"
              icon="folder"
              onClick={(event) => setEditing({ machine: null, returnTo: event.currentTarget })}
            >
              + Dodaj mašinu
            </Button>
          </div>
        ) : null}
      </div>

      {message ? (
        <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </Alert>
      ) : null}

      <Card>
        <div className="gx-filters" style={{ marginBottom: "var(--space-5)" }}>
          <Field label="Traži mašinu" htmlFor="equipment-filter">
            <input
              id="equipment-filter"
              className={inputClass}
              placeholder="Oznaka, naziv, tablice"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </Field>
          <Field label="Kategorija" htmlFor="equipment-category">
            <select
              id="equipment-category"
              className={inputClass}
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="">Sve kategorije</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="gx-check" style={{ paddingBottom: 10 }}>
            <input
              id="equipment-show-inactive"
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            <label htmlFor="equipment-show-inactive">Prikaži i neaktivne ({inactiveCount})</label>
          </div>
        </div>

        {state.kind === "loading" ? <Skeleton rows={4} /> : null}

        {state.kind === "error" ? (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <Alert tone="error" role="alert">
              {state.message}
            </Alert>
            <div>
              <Button onClick={() => void load()}>Pokušaj ponovo</Button>
            </div>
          </div>
        ) : null}

        {state.kind === "ready" && machines.length === 0 ? (
          <EmptyState
            title="Još nema mašina"
            description="Dodajte prvu mašinu ili uvezite spisak iz Excela (Uvoz)."
            action={
              canManage ? (
                <Button
                  variant="primary"
                  onClick={(event) => setEditing({ machine: null, returnTo: event.currentTarget })}
                >
                  + Dodaj mašinu
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {state.kind === "ready" && machines.length > 0 && visible.length === 0 ? (
          <EmptyState
            title="Nema mašina koje odgovaraju filteru"
            description="Promijenite tekst ili kategoriju."
            action={
              <Button
                onClick={() => {
                  setFilter("");
                  setCategoryFilter("");
                  setShowInactive(true);
                }}
              >
                Prikaži sve
              </Button>
            }
          />
        ) : null}

        {visible.length > 0 ? (
          <table className="gx-table gx-table--cards">
            <thead>
              <tr>
                <th>Mašina</th>
                <th>Kategorija</th>
                <th>Brojilo</th>
                <th>Vlasništvo</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((machine) => (
                <MachineRow
                  key={machine.id}
                  machine={machine}
                  canManage={canManage}
                  onEdit={(returnTo) => setEditing({ machine, returnTo })}
                  onMeter={(returnTo) => setMeterFor({ machine, returnTo })}
                  onToggle={() => void toggleActive(machine)}
                />
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>

      {editing ? (
        <MachineDialog
          machine={editing.machine}
          categories={categories}
          returnFocusTo={editing.returnTo}
          onSaved={async (text) => {
            setEditing(null);
            setMessage({ tone: "success", text });
            await load();
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {meterFor ? (
        <MeterDialog
          machine={meterFor.machine}
          returnFocusTo={meterFor.returnTo}
          onSaved={async (text) => {
            setMeterFor(null);
            setMessage({ tone: "success", text });
            await load();
          }}
          onClose={() => setMeterFor(null)}
        />
      ) : null}

      {categoriesOpen ? (
        <CategoriesDialog
          categories={categories}
          onChanged={async (text) => {
            setMessage({ tone: "success", text });
            await load();
          }}
          onClose={() => setCategoriesOpen(false)}
        />
      ) : null}
    </div>
  );
}

function MachineRow({
  machine,
  canManage,
  onEdit,
  onMeter,
  onToggle,
}: {
  machine: MachineRow;
  canManage: boolean;
  onEdit: (returnTo: HTMLElement | null) => void;
  onMeter: (returnTo: HTMLElement | null) => void;
  onToggle: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <tr>
      <td data-label="Mašina">
        <div className="gx-who" style={{ fontWeight: 600 }}>
          <Mono>{machine.code}</Mono> {machine.name}
          <span>
            {[machine.make, machine.model, machine.plate, machine.year].filter(Boolean).join(" · ") || "—"}
          </span>
        </div>
      </td>
      <td data-label="Kategorija">{machine.categoryName}</td>
      <td data-label="Brojilo">
        <div style={{ display: "grid", gap: 2 }}>
          <span className="gx-mono">
            {machine.meterValue === null ? "—" : `${formatNumber(machine.meterValue)} ${meterUnit(machine.meter)}`}
          </span>
          <span style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
            {machine.meterUpdatedAt ? `upisano ${formatDateTime(machine.meterUpdatedAt)}` : "bez upisa"}
          </span>
        </div>
      </td>
      <td data-label="Vlasništvo">{ownershipLabel(machine.ownership)}</td>
      <td data-label="Status">
        <Chip tone={machine.isActive ? "full" : "hollow"}>{machine.isActive ? "Aktivna" : "Neaktivna"}</Chip>
      </td>
      <td data-label="Akcija">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          {/* Jedina akcija koja se radi često: upis brojila. Zato je u redu, ne u meniju. */}
          <Button
            variant="secondary"
            className="whitespace-nowrap"
            onClick={(event) => onMeter(event.currentTarget)}
          >
            Upisi brojilo
          </Button>
          {canManage ? (
            <div className="relative">
              <button
                ref={moreButton}
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Više radnji za ${machine.code}`}
                onClick={() => setMenuOpen((open) => !open)}
                className="gx-icon-btn"
              >
                <Icon name="more" />
              </button>
              {menuOpen ? (
                <div role="menu" className="gx-menu">
                  <button
                    role="menuitem"
                    type="button"
                    className="gx-menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit(moreButton.current);
                    }}
                  >
                    Izmijeni mašinu
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    className="gx-menu-item"
                    style={{ color: "var(--danger)" }}
                    onClick={() => {
                      setMenuOpen(false);
                      onToggle();
                    }}
                  >
                    {machine.isActive ? "Deaktiviraj" : "Aktiviraj"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function MachineDialog({
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
      <form onSubmit={save} style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-5)" }}>
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

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Inventarska oznaka" htmlFor="machine-code" hint="2–20 znakova: velika slova, brojevi, crtica.">
            <input
              id="machine-code"
              className={inputClass}
              value={form.code}
              onChange={(event) => set("code", event.target.value)}
              required
              maxLength={20}
              autoComplete="off"
              placeholder="BAG-01"
              style={{ textTransform: "uppercase" }}
            />
          </Field>
          <Field label="Naziv" htmlFor="machine-name">
            <input
              id="machine-name"
              className={inputClass}
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              required
              maxLength={120}
              autoComplete="off"
              placeholder="Bager CAT 320"
            />
          </Field>
        </div>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field
            label="Kategorija"
            htmlFor="machine-category"
            hint={category ? `Brojilo: ${meterUnit(category.meter)}` : "Kategorija nosi vrstu brojila."}
          >
            <select
              id="machine-category"
              className={inputClass}
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
            </select>
          </Field>
          <Field label="Vlasništvo" htmlFor="machine-ownership">
            <select
              id="machine-ownership"
              className={inputClass}
              value={form.ownership}
              onChange={(event) => set("ownership", event.target.value)}
            >
              <option value="OWN">Svoje</option>
              <option value="RENT">Najam</option>
            </select>
          </Field>
        </div>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Marka" htmlFor="machine-make">
            <input
              id="machine-make"
              className={inputClass}
              value={form.make}
              onChange={(event) => set("make", event.target.value)}
              maxLength={80}
            />
          </Field>
          <Field label="Model" htmlFor="machine-model">
            <input
              id="machine-model"
              className={inputClass}
              value={form.model}
              onChange={(event) => set("model", event.target.value)}
              maxLength={80}
            />
          </Field>
        </div>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Serijski broj" htmlFor="machine-serial">
            <input
              id="machine-serial"
              className={inputClass}
              value={form.serialNo}
              onChange={(event) => set("serialNo", event.target.value)}
              maxLength={80}
            />
          </Field>
          <Field label="Registarska oznaka" htmlFor="machine-plate">
            <input
              id="machine-plate"
              className={inputClass}
              value={form.plate}
              onChange={(event) => set("plate", event.target.value)}
              maxLength={20}
              style={{ textTransform: "uppercase" }}
            />
          </Field>
        </div>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Godina" htmlFor="machine-year">
            <input
              id="machine-year"
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={1900}
              max={2100}
              value={form.year}
              onChange={(event) => set("year", event.target.value)}
            />
          </Field>
          {meterLocked ? (
            <Field
              label="Brojilo"
              htmlFor="machine-meter-locked"
              hint="Vrsta se ne mijenja dok brojilo ima vrijednost."
            >
              <input
                id="machine-meter-locked"
                className={inputClass}
                value={`${formatNumber(machine?.meterValue ?? null)} ${meterUnit(machine?.meter ?? "HOURS")}`}
                readOnly
                disabled
              />
            </Field>
          ) : (
            <Field
              label="Početno stanje brojila"
              htmlFor="machine-meter-value"
              hint={category ? `U ${meterUnit(category.meter)}. Može i prazno.` : "Izaberite kategoriju."}
            >
              <input
                id="machine-meter-value"
                className={inputClass}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.1"
                value={form.meterValue}
                onChange={(event) => set("meterValue", event.target.value)}
                disabled={!machine && !category}
              />
            </Field>
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
function MeterDialog({
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
      <div style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-5)" }}>
        <p style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
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

        <Field
          label="Novo stanje"
          htmlFor="meter-value"
          hint={`U ${meterUnit(machine.meter)}. Zarez ili tačka — oboje prolazi.`}
        >
          <input
            id="meter-value"
            className={inputClass}
            inputMode="decimal"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setConflict(null);
            }}
            placeholder="1234,5"
            autoComplete="off"
          />
        </Field>

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

        <p style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
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
function CategoriesDialog({
  categories,
  onChanged,
  onClose,
}: {
  categories: CategoryRow[];
  onChanged: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [meter, setMeter] = useState("HOURS");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await apiCall<{ category: CategoryRow }>(
        "/api/equipment-categories",
        jsonBody({ code: code.trim().toUpperCase(), name: name.trim(), meter }),
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setCode("");
      setName("");
      await onChanged(`Kategorija „${name.trim()}“ je dodana.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Kategorije mašina"
      hint="Kategorija nosi vrstu brojila i mapira se iz Excela pri uvozu."
      onClose={onClose}
      wide
    >
      <div style={{ marginTop: "var(--space-5)", display: "grid", gap: "var(--space-5)" }}>
        {categories.length === 0 ? (
          <Alert tone="info">Još nema kategorija — dodajte prvu ispod.</Alert>
        ) : (
          <table className="gx-table gx-table--cards">
            <thead>
              <tr>
                <th>Naziv</th>
                <th>Oznaka</th>
                <th>Brojilo</th>
                <th style={{ textAlign: "right" }}>Mašina</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <td data-label="Naziv">{category.name}</td>
                  <td data-label="Oznaka">
                    <Mono>{category.code}</Mono>
                  </td>
                  <td data-label="Brojilo">{meterUnit(category.meter)}</td>
                  <td data-label="Mašina" style={{ textAlign: "right" }}>
                    <span className="gx-mono">{category.machineCount}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form onSubmit={add} style={{ display: "grid", gap: "var(--space-4)" }}>
          <SectionTitle hint="Nova kategorija vrijedi za cijelu firmu.">Dodaj kategoriju</SectionTitle>
          {error ? (
            <Alert tone="error" role="alert">
              {error}
            </Alert>
          ) : null}
          <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
            <Field label="Naziv" htmlFor="category-name">
              <input
                id="category-name"
                className={inputClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={80}
                placeholder="Bager"
              />
            </Field>
            <Field label="Oznaka" htmlFor="category-code" hint="Velika slova, bez razmaka. Koristi se u uvozu.">
              <input
                id="category-code"
                className={inputClass}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
                minLength={2}
                maxLength={40}
                placeholder="EXCAVATOR"
                style={{ textTransform: "uppercase" }}
              />
            </Field>
            <Field label="Brojilo" htmlFor="category-meter">
              <select
                id="category-meter"
                className={inputClass}
                value={meter}
                onChange={(event) => setMeter(event.target.value)}
              >
                <option value="HOURS">Sati</option>
                <option value="KM">Kilometri</option>
              </select>
            </Field>
          </div>
          <div className="gx-dialog__actions">
            <Button variant="quiet" onClick={onClose} disabled={saving}>
              Zatvori
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Dodajem…" : "Dodaj kategoriju"}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}

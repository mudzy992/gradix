"use client";

/**
 * Komponente i parametri obračuna (F6, spec 07 §4 — `/ured/obracun-sati/postavke`).
 *
 * Odluke ekrana:
 *   1. **Parametar nije „vrijednost“, nego VAŽENJE.** Svaki red ima `valid_from` (i `valid_to`),
 *      jer promjena stope od narednog mjeseca ne smije prepisati stari obračun. Zato se novi
 *      red DODAJE, a stari ostaje u istoriji sa „ko je potvrdio“.
 *   2. **Potrebni kodovi su vidljivi i kad nedostaju.** `required_codes` dolazi sa servera;
 *      ono što nije uneseno stoji na vrhu kao upozorenje, prije izračuna — ne poslije.
 *   3. **Nijedna stopa nije u kodu.** Ekran ne predlaže 1,3 ni 1,5; samo kaže koje jedinice
 *      postoje (`MULTIPLIER`/`PERCENT`/`CENTS`) i pušta računovodstvo da unese svoje.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import {
  Alert, Badge, Button, DataTable, Dialog, FormField, Input, Inline, SelectField as Select, Skeleton, Stack, Switch,
} from "@/components/ui/index";

type Component = {
  id: string;
  code: string;
  name: string;
  kind: "EARNING" | "DEDUCTION";
  basis: "HOURS" | "DAYS" | "FIXED" | "PERCENT_OF_EARNINGS";
  category: string;
  is_taxable: boolean;
  sort_order: number;
  is_active: boolean;
};

type Parameter = {
  id: string;
  code: string;
  value: string;
  unit: "MULTIPLIER" | "PERCENT" | "CENTS";
  valid_from: string;
  valid_to: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string;
  note: string | null;
};

const BASIS_LABEL: Record<Component["basis"], string> = {
  HOURS: "sati",
  DAYS: "dani",
  FIXED: "fiksno",
  PERCENT_OF_EARNINGS: "% zarade",
};

const UNIT_LABEL: Record<Parameter["unit"], string> = {
  MULTIPLIER: "množilac",
  PERCENT: "%",
  CENTS: "centi",
};

export function PayrollSettingsClient({ canManage }: { canManage: boolean }) {
  const [components, setComponents] = useState<Component[] | null>(null);
  const [parameters, setParameters] = useState<Parameter[] | null>(null);
  const [required, setRequired] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [parameterOpen, setParameterOpen] = useState(false);
  const [componentOpen, setComponentOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [componentResult, parameterResult] = await Promise.all([
      apiCall<{ components: Component[] }>("/api/payroll/components"),
      apiCall<{ parameters: Parameter[]; required_codes: string[] }>("/api/payroll/parameters"),
    ]);
    if (!componentResult.ok) setError(componentResult.message);
    else setComponents(componentResult.data.components);
    if (!parameterResult.ok) setError(parameterResult.message);
    else {
      setParameters(parameterResult.data.parameters);
      setRequired(parameterResult.data.required_codes);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const missing = required.filter(
    (code) => !(parameters ?? []).some((row) => row.code === code && row.valid_to === null),
  );

  const toggleComponent = async (component: Component, active: boolean) => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall<Component>(`/api/payroll/components/${component.id}`, patchBody({ is_active: active }));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(active ? "Komponenta je aktivirana." : "Komponenta je ugašena. Istorija je čuva.");
    await load();
  };

  if (components === null || parameters === null) {
    return error ? <Alert tone="error">{error}</Alert> : <Skeleton rows={6} />;
  }

  return (
    <Stack gap="var(--space-5)">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {missing.length > 0 ? (
        <Alert tone="warning">
          Nedostaju potvrđene vrijednosti: <strong>{missing.join(", ")}</strong>. Period sa tim
          komponentama dobiće linije bez iznosa (<code>PARAMETER_MISSING</code>) i ne može se odobriti.
        </Alert>
      ) : null}

      <div>
        <Inline>
          <h2 className="gx-page-title">Parametri</h2>
          {canManage ? (
            <Button variant="primary" onClick={() => setParameterOpen(true)}>
              Novo važenje
            </Button>
          ) : null}
        </Inline>
        <p className="gx-page-sub">
          Vrijednost važi od datuma; nova vrijednost se DODAJE i ne mijenja stari obračun.
          Nijedna stopa nije ugrađena u program — sve su podaci koje potvrđuje računovodstvo.
        </p>
        <DataTable
          caption="Parametri obračuna"
          rows={parameters}
          rowKey={(row) => row.id}
          columns={[
            { key: "code", header: "Kod", cell: (row) => <strong>{row.code}</strong> },
            { key: "value", header: "Vrijednost", numeric: true, cell: (row) => row.value },
            { key: "unit", header: "Jedinica", cell: (row) => UNIT_LABEL[row.unit] },
            { key: "from", header: "Važi od", cell: (row) => row.valid_from },
            { key: "to", header: "Važi do", cell: (row) => row.valid_to ?? "—" },
            { key: "by", header: "Potvrdio", cell: (row) => row.confirmed_by_name ?? "—" },
            { key: "note", header: "Napomena", cell: (row) => row.note ?? "—" },
          ]}
        />
      </div>

      <div>
        <Inline>
          <h2 className="gx-page-title">Komponente</h2>
          {canManage ? (
            <Button onClick={() => setComponentOpen(true)}>Nova komponenta</Button>
          ) : null}
        </Inline>
        <p className="gx-page-sub">
          Šifarnik po firmi. Komponenta se ne briše — gasi se, jer je obračun koji je koristi
          istorija.
        </p>
        <DataTable
          caption="Komponente obračuna"
          rows={components}
          rowKey={(row) => row.id}
          columns={[
            { key: "code", header: "Kod", cell: (row) => <strong>{row.code}</strong> },
            { key: "name", header: "Naziv", cell: (row) => row.name },
            {
              key: "kind",
              header: "Vrsta",
              cell: (row) => (row.kind === "EARNING" ? <Badge>zarada</Badge> : <Badge tone="quiet">odbitak</Badge>),
            },
            { key: "basis", header: "Osnov", cell: (row) => BASIS_LABEL[row.basis] },
            { key: "category", header: "Kategorija", cell: (row) => row.category },
            {
              key: "active",
              header: "Aktivna",
              cell: (row) =>
                canManage ? (
                  <Switch
                    label={`Aktivna: ${row.code}`}
                    checked={row.is_active}
                    disabled={busy}
                    onChange={(event) => void toggleComponent(row, event.target.checked)}
                  />
                ) : (
                  row.is_active ? "da" : "ne"
                ),
            },
          ]}
        />
      </div>

      <ParameterDialog
        open={parameterOpen}
        required={required}
        onClose={() => setParameterOpen(false)}
        onDone={async (message) => {
          setParameterOpen(false);
          setNotice(message);
          await load();
        }}
        onError={setError}
      />

      <ComponentDialog
        open={componentOpen}
        onClose={() => setComponentOpen(false)}
        onDone={async (message) => {
          setComponentOpen(false);
          setNotice(message);
          await load();
        }}
        onError={setError}
      />
    </Stack>
  );
}

function ParameterDialog({
  open, required, onClose, onDone, onError,
}: {
  open: boolean;
  required: string[];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [code, setCode] = useState(required[0] ?? "");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<Parameter["unit"]>("MULTIPLIER");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const result = await apiCall<Parameter>("/api/payroll/parameters", jsonBody({
      code: code.trim().toUpperCase(),
      value: value.trim(),
      unit,
      valid_from: validFrom,
      note: note.trim() ? note.trim() : undefined,
    }));
    setBusy(false);
    if (!result.ok) {
      onError(result.message);
      return;
    }
    await onDone(`Parametar ${code} važi od ${validFrom}.`);
  };

  if (!open) return null;

  return (
    <Dialog onClose={onClose} title="Novo važenje parametra">
      <Stack>
        <FormField label="Kod">
          <Select value={code} onChange={(event) => setCode(event.target.value)}>
            {required.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Vrijednost (decimalni broj)">
          <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="npr. 1.30" />
        </FormField>
        <FormField label="Jedinica">
          <Select value={unit} onChange={(event) => setUnit(event.target.value as Parameter["unit"])}>
            <option value="MULTIPLIER">množilac (1.30)</option>
            <option value="PERCENT">procenat (100)</option>
            <option value="CENTS">centi (2000 = 20,00)</option>
          </Select>
        </FormField>
        <FormField label="Važi od">
          <Input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
        </FormField>
        <FormField label="Napomena (opciono)">
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </FormField>
        <Inline>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !value.trim()}>
            {busy ? "Upisujem…" : "Potvrdi važenje"}
          </Button>
          <Button variant="quiet" onClick={onClose}>Otkaži</Button>
        </Inline>
      </Stack>
    </Dialog>
  );
}

function ComponentDialog({
  open, onClose, onDone, onError,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Component["kind"]>("EARNING");
  const [basis, setBasis] = useState<Component["basis"]>("FIXED");
  const [category, setCategory] = useState("OTHER");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const result = await apiCall<Component>("/api/payroll/components", jsonBody({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      kind,
      basis,
      category,
    }));
    setBusy(false);
    if (!result.ok) {
      onError(result.message);
      return;
    }
    await onDone(`Komponenta ${code.toUpperCase()} je dodata.`);
  };

  if (!open) return null;

  return (
    <Dialog onClose={onClose} title="Nova komponenta">
      <Stack>
        <FormField label="Šifra (velika slova, bez razmaka)">
          <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="DODATAK_PREVOZ" />
        </FormField>
        <FormField label="Naziv">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </FormField>
        <FormField label="Vrsta">
          <Select value={kind} onChange={(event) => setKind(event.target.value as Component["kind"])}>
            <option value="EARNING">zarada</option>
            <option value="DEDUCTION">odbitak</option>
          </Select>
        </FormField>
        <FormField label="Osnov">
          <Select value={basis} onChange={(event) => setBasis(event.target.value as Component["basis"])}>
            <option value="HOURS">sati</option>
            <option value="DAYS">dani</option>
            <option value="FIXED">fiksni iznos</option>
            <option value="PERCENT_OF_EARNINGS">% zarade</option>
          </Select>
        </FormField>
        <FormField label="Kategorija">
          <Select value={category} onChange={(event) => setCategory(event.target.value)}>
            {["REGULAR", "OVERTIME", "NIGHT", "SUNDAY", "HOLIDAY", "ABSENCE", "FIELD_ALLOWANCE", "ADVANCE", "LOAN", "OTHER"].map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </FormField>
        <Inline>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !code.trim() || !name.trim()}>
            {busy ? "Upisujem…" : "Dodaj komponentu"}
          </Button>
          <Button variant="quiet" onClick={onClose}>Otkaži</Button>
        </Inline>
      </Stack>
    </Dialog>
  );
}

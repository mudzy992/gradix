"use client";

/**
 * F4 (Modul 5 §4) — komponente stope troška mašine.
 *
 * Ekran pokazuje OBA broja: izračunatu stopu iz komponenti i ručnu stopu ako postoji. To je
 * namjerno — ručna stopa bez uporedne izračunate je nevidljiva odluka, a upravo se takve odluke
 * poslije ne mogu objasniti. „Vrati na izračunato" uvijek je uz ručni iznos.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { calendarDateFromLocalDate } from "@gradix/domain";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import {
  Alert, Button, Card, DataTable, Dialog, EmptyState, Input, Select, Skeleton, Stack,
} from "@/components/ui/index";

type Component = "DEPRECIATION" | "FUEL" | "SERVICE" | "OPERATOR" | "INSURANCE" | "OTHER" | "RENTAL";
type Basis = "PER_HOUR" | "PER_MONTH" | "PER_KM";

type ComponentRow = {
  id: string;
  machine_id: string;
  component: Component;
  basis: Basis;
  amount: string;
  currency_code: string;
  valid_from: string;
  valid_to: string | null;
  note: string | null;
};

type RateView = {
  machine_code: string;
  machine_name: string;
  calculated_rate: string;
  manual_rate: string | null;
  manual_reason: string | null;
  effective_rate: string;
  is_manual: boolean;
  currency_code: string;
  planned_hours_per_month: number;
  breakdown: { component: Component; basis: Basis; amount: string; cents_per_hour: string }[];
};

/** Bosanski nazivi komponenti — jedan izvor za tabelu, formu i razlaganje. */
const COMPONENT_LABELS: Record<Component, string> = {
  DEPRECIATION: "Amortizacija",
  FUEL: "Gorivo",
  SERVICE: "Servis",
  OPERATOR: "Rukovalac",
  INSURANCE: "Osiguranje",
  OTHER: "Ostalo",
  RENTAL: "Najam",
};

const BASIS_LABELS: Record<Basis, string> = {
  PER_HOUR: "po satu",
  PER_MONTH: "mjesečno",
  PER_KM: "po km",
};

export function CostComponentsPanel({
  machineId,
  machineLabel,
  caps,
  onChanged,
}: {
  machineId: string;
  machineLabel: string;
  caps: { canManage: boolean };
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<ComponentRow[] | null>(null);
  const [rate, setRate] = useState<RateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [components, computed] = await Promise.all([
      apiCall<{ components: ComponentRow[] }>(`/api/machines/${machineId}/cost-components`),
      apiCall<{ rate: RateView }>(`/api/machines/${machineId}/cost-rate`),
    ]);
    if (!components.ok) {
      setError(components.message);
      return;
    }
    if (!computed.ok) {
      setError(computed.message);
      return;
    }
    setRows(components.data.components);
    setRate(computed.data.rate);
  }, [machineId]);

  useEffect(() => { void load(); }, [load]);

  const refresh = () => {
    void load();
    onChanged?.();
  };

  const active = useMemo(() => (rows ?? []).filter((row) => row.valid_to === null), [rows]);

  if (error) return <Alert tone="error" role="alert">{error}</Alert>;
  if (!rows || !rate) return <Skeleton rows={3} />;

  return (
    <Stack gap="var(--space-4)">
      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}

      <Card>
        <Stack gap="var(--space-3)">
          <div className="gx-inline-flex gx-spread">
            <div>
              <strong>{machineLabel} — trošak po satu</strong>
              <p className="gx-muted">
                Izračunato iz komponenti, sa {rate.planned_hours_per_month} planiranih sati mjesečno.
              </p>
            </div>
            <div aria-live="polite">
              <span className="gx-page-title">
                {rate.effective_rate} {rate.currency_code}/h
              </span>
            </div>
          </div>

          {rate.is_manual ? (
            /*
             * Ručna stopa je ODSTUPANJE i to piše crno na bijelo, uz razlog. Bez prikaza
             * izračunate vrijednosti korisnik ne bi vidio koliko odstupa — a to je jedini
             * podatak po kojem se odluka kasnije može preispitati.
             */
            <Alert tone="warning">
              <strong>Ručna stopa je na snazi.</strong> Izračunato iz komponenti:{" "}
              {rate.calculated_rate} {rate.currency_code}/h. Razlog: {rate.manual_reason ?? "—"}.
            </Alert>
          ) : null}

          <DataTable
            caption="Razlaganje stope"
            rows={rate.breakdown}
            rowKey={(row) => `${row.component}-${row.basis}`}
            columns={[
              { key: "component", header: "Komponenta", cell: (row) => COMPONENT_LABELS[row.component] },
              { key: "basis", header: "Osnova", cell: (row) => BASIS_LABELS[row.basis] },
              { key: "amount", header: "Iznos", cell: (row) => `${row.amount} ${rate.currency_code}` },
              { key: "per", header: "Po satu", cell: (row) => `${row.cents_per_hour} ${rate.currency_code}` },
            ]}
            empty={<EmptyState title="Nema komponenti" description="Bez komponenti stopa je nula i trošak se ne knjiži." />}
          />
          {caps.canManage ? (
            <div className="gx-inline-flex">
              <Button variant="primary" icon="plus" onClick={() => setFormOpen(true)}>Nova komponenta</Button>
              <Button variant="secondary" onClick={() => setManualOpen(true)}>
                {rate.is_manual ? "Promijeni ručnu stopu" : "Ručna stopa"}
              </Button>
            </div>
          ) : null}
        </Stack>
      </Card>

      <DataTable
        caption="Komponente sa istorijom"
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          { key: "component", header: "Komponenta", cell: (row) => COMPONENT_LABELS[row.component] },
          { key: "basis", header: "Osnova", cell: (row) => BASIS_LABELS[row.basis] },
          { key: "amount", header: "Iznos", cell: (row) => `${row.amount} ${row.currency_code}` },
          { key: "from", header: "Važi od", cell: (row) => row.valid_from },
          {
            key: "to",
            header: "Važi do",
            cell: (row) => (row.valid_to === null ? <span className="gx-chip">važeća</span> : row.valid_to),
          },
          {
            key: "actions",
            header: "",
            cell: (row) =>
              caps.canManage && row.valid_to === null ? (
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const today = calendarDateFromLocalDate(new Date());
                    const res = await apiCall<{ outcome: string; message?: string }>(
                      `/api/machines/${machineId}/cost-components`,
                      patchBody({
                        id: row.id,
                        machineId,
                        component: row.component,
                        basis: row.basis,
                        amount: row.amount,
                        validFrom: row.valid_from,
                        validTo: today,
                      }),
                    );
                    setBusy(false);
                    if (!res.ok || res.data.outcome !== "OK") {
                      setError(res.ok ? res.data.message ?? "Zatvaranje nije uspjelo." : res.message);
                      return;
                    }
                    setNotice("Komponenta je zatvorena — istorija ostaje.");
                    refresh();
                  }}
                >
                  Zatvori danas
                </Button>
              ) : null,
          },
        ]}
        empty={<EmptyState title="Nema zapisa" description="Prva komponenta otvara istoriju troška." />}
      />

      {formOpen ? (
        <ComponentForm
          machineId={machineId}
          busy={busy}
          onBusy={setBusy}
          onClose={() => setFormOpen(false)}
          onDone={() => {
            setFormOpen(false);
            setNotice("Komponenta je dodata; prethodna važeća je zatvorena.");
            refresh();
          }}
          onError={setError}
        />
      ) : null}

      {manualOpen ? (
        <ManualRateForm
          machineId={machineId}
          isManual={rate.is_manual}
          busy={busy}
          onBusy={setBusy}
          onClose={() => setManualOpen(false)}
          onDone={(text) => {
            setManualOpen(false);
            setNotice(text);
            refresh();
          }}
          onError={setError}
        />
      ) : null}
      <p className="gx-muted" aria-live="polite">
        {active.length} važećih komponenti
      </p>
    </Stack>
  );
}

function ComponentForm({
  machineId, busy, onBusy, onClose, onDone, onError,
}: {
  machineId: string;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const today = calendarDateFromLocalDate(new Date());
  const [component, setComponent] = useState<Component>("DEPRECIATION");
  const [basis, setBasis] = useState<Basis>("PER_MONTH");
  const [amount, setAmount] = useState("");
  const [validFrom, setValidFrom] = useState(today);
  const [note, setNote] = useState("");

  const submit = async () => {
    if (!amount.trim()) {
      onError("Iznos je obavezan.");
      return;
    }
    onBusy(true);
    const res = await apiCall<{ outcome: string; message?: string }>(
      `/api/machines/${machineId}/cost-components`,
      jsonBody({ machineId, component, basis, amount: amount.trim(), validFrom, note: note.trim() || null }),
    );
    onBusy(false);
    if (!res.ok || res.data.outcome !== "OK") {
      onError(res.ok ? res.data.message ?? "Spremanje nije uspjelo." : res.message);
      return;
    }
    onDone();
  };

  return (
    <Dialog
      title="Nova komponenta stope"
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Otkaži</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>Sačuvaj</Button>
        </>
      )}
    >
      <Select label="Komponenta" value={component} onChange={(event) => setComponent(event.target.value as Component)}>
        {(Object.keys(COMPONENT_LABELS) as Component[]).map((key) => (
          <option key={key} value={key}>{COMPONENT_LABELS[key]}</option>
        ))}
      </Select>
      <Select label="Osnova" value={basis} onChange={(event) => setBasis(event.target.value as Basis)}>
        {(Object.keys(BASIS_LABELS) as Basis[]).map((key) => (
          <option key={key} value={key}>{BASIS_LABELS[key]}</option>
        ))}
      </Select>
      <Input
        label="Iznos (npr. 1200.00)"
        value={amount}
        inputMode="decimal"
        onChange={(event) => setAmount(event.target.value)}
        hint="Mjesečna osnova se dijeli sa planiranim satima; po kilometru ulazi tek uz kilometražu."
      />
      <Input label="Važi od" type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
      <Input label="Napomena (opciono)" value={note} onChange={(event) => setNote(event.target.value)} />
    </Dialog>
  );
}

function ManualRateForm({
  machineId, isManual, busy, onBusy, onClose, onDone, onError,
}: {
  machineId: string;
  isManual: boolean;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const today = calendarDateFromLocalDate(new Date());
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [validFrom, setValidFrom] = useState(today);

  const submit = async (value: string | null) => {
    if (value !== null) {
      if (value.trim().length === 0) {
        onError("Iznos je obavezan.");
        return;
      }
      /*
       * Razlog se provjerava i ovdje, iako ga servis traži: bez toga bi korisnik saznao da je
       * razlog prekratak tek poslije slanja, pa bi izgubio ono što je već napisao.
       */
      if (reason.trim().length < 10) {
        onError("Razlog mora imati najmanje 10 znakova — ide u audit trag.");
        return;
      }
    }
    onBusy(true);
    const res = await apiCall<{ rate: RateView } | { outcome: string; message?: string }>(
      `/api/machines/${machineId}/cost-rate`,
      jsonBody({ machineId, amount: value, reason: value === null ? null : reason.trim(), validFrom }),
    );
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    onDone(value === null ? "Vraćeno na izračunatu stopu." : "Ručna stopa je upisana.");
  };

  return (
    <Dialog
      title="Ručna stopa troška"
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Otkaži</Button>
          {isManual ? (
            <Button variant="secondary" disabled={busy} onClick={() => void submit(null)}>
              Vrati na izračunato
            </Button>
          ) : null}
          <Button variant="primary" disabled={busy} onClick={() => void submit(amount)}>Sačuvaj</Button>
        </>
      )}
    >
      <p className="gx-muted">
        Ručna stopa nadjačava izračunatu i ide u audit sa razlogom. Izračunata ostaje vidljiva na
        kartici, da odstupanje ne bude skriveno.
      </p>
      <Input label="Iznos po satu" value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} />
      <Input
        label="Razlog (najmanje 10 znakova)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        hint="npr. „Najam po dnevnoj cijeni — čeka se račun dobavljača“"
      />
      <Input label="Važi od" type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
    </Dialog>
  );
}

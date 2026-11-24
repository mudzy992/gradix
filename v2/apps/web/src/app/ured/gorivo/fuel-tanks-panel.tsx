"use client";

/**
 * F4 (Modul 5 §1.3.14) — cisterne.
 *
 * Cisterna i pumpa se NIKAD ne vode paralelno: kad je cisterna uključena u postavkama firme,
 * točenje nosi `tank_id` i skida stanje; kad nije, točenje je na pumpi i stanja nema. Ekran zato
 * prikazuje stanje i dugme „Popis", a ne „prepravi stanje": stanje se mijenja točenjem i popisom,
 * a razlika između izvedenog i očitanog je ono zbog čega popis i postoji.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import {
  Alert, Button, DataTable, Dialog, EmptyState, Input, Select, Skeleton, Stack,
} from "@/components/ui/index";

type Tank = {
  id: string;
  name: string;
  capacity_l: number;
  current_l: number;
  last_count_at: string | null;
  is_active: boolean;
};

export function FuelTanksPanel({ canManage }: { canManage: boolean }) {
  const [tanks, setTanks] = useState<Tank[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [countFor, setCountFor] = useState<Tank | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiCall<{ tanks: Tank[] }>("/api/fuel-tanks");
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setTanks(res.data.tanks);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <Alert tone="error" role="alert">{error}</Alert>;
  if (!tanks) return <Skeleton rows={2} />;

  return (
    <Stack gap="var(--space-4)">
      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}
      {canManage ? (
        <div className="gx-inline-flex">
          <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>Nova cisterna</Button>
        </div>
      ) : null}
      <DataTable
        caption="Cisterne"
        rows={tanks}
        rowKey={(tank) => tank.id}
        columns={[
          { key: "name", header: "Cisterna", cell: (tank) => tank.name },
          { key: "current", header: "Stanje", cell: (tank) => `${tank.current_l.toFixed(0)} l` },
          { key: "capacity", header: "Kapacitet", cell: (tank) => `${tank.capacity_l.toFixed(0)} l` },
          {
            key: "count",
            header: "Zadnji popis",
            cell: (tank) => (tank.last_count_at ? tank.last_count_at.slice(0, 16).replace("T", " ") : "—"),
          },
          {
            key: "actions",
            header: "",
            cell: (tank) =>
              canManage ? (
                <Button variant="secondary" onClick={() => setCountFor(tank)}>Popis</Button>
              ) : null,
          },
        ]}
        empty={(
          <EmptyState
            title="Nema cisterne"
            description="Bez cisterne gorivo se vodi po pumpi — stanje se ne prati, ali točenja se unose normalno."
          />
        )}
      />

      {createOpen ? (
        <CreateTankDialog
          busy={busy}
          onBusy={setBusy}
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); setNotice("Cisterna je upisana."); void load(); }}
          onError={setError}
        />
      ) : null}

      {countFor ? (
        <CountDialog
          tank={countFor}
          busy={busy}
          onBusy={setBusy}
          onClose={() => setCountFor(null)}
          onDone={() => { setCountFor(null); setNotice("Popis je zapisan sa razlikom u audit tragu."); void load(); }}
          onError={setError}
        />
      ) : null}
    </Stack>
  );
}

function CreateTankDialog({
  busy, onBusy, onClose, onDone, onError,
}: {
  busy: boolean;
  onBusy: (value: boolean) => void;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [current, setCurrent] = useState("0");

  const submit = async () => {
    if (!name.trim() || !capacity.trim()) {
      onError("Naziv i kapacitet su obavezni.");
      return;
    }
    onBusy(true);
    const res = await apiCall<Tank>("/api/fuel-tanks", jsonBody({
      name: name.trim(),
      capacityL: Number(capacity),
      currentL: Number(current || "0"),
    }));
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    onDone();
  };

  return (
    <Dialog
      title="Nova cisterna"
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Otkaži</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>Sačuvaj</Button>
        </>
      )}
    >
      <Input label="Naziv" value={name} onChange={(event) => setName(event.target.value)} />
      <Input label="Kapacitet (l)" value={capacity} inputMode="decimal" onChange={(event) => setCapacity(event.target.value)} />
      <Input
        label="Početno stanje (l)"
        value={current}
        inputMode="decimal"
        onChange={(event) => setCurrent(event.target.value)}
        hint="Ako nije popisano, ostavite 0 — popis će ispraviti stanje."
      />
    </Dialog>
  );
}

function CountDialog({
  tank, busy, onBusy, onClose, onDone, onError,
}: {
  tank: Tank;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [current, setCurrent] = useState(String(tank.current_l));
  const [note, setNote] = useState("");

  const parsed = Number(current);
  const difference = Number.isFinite(parsed) ? parsed - tank.current_l : 0;

  const submit = async () => {
    if (!current.trim() || !Number.isFinite(parsed)) {
      onError("Očitano stanje je obavezno.");
      return;
    }
    onBusy(true);
    const res = await apiCall<Tank>(`/api/fuel-tanks/${tank.id}/count`, patchBody({
      currentL: parsed,
      note: note.trim() || null,
    }));
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    onDone();
  };

  return (
    <Dialog
      title={`Popis: ${tank.name}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Otkaži</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>Zapiši popis</Button>
        </>
      )}
    >
      <p className="gx-muted">
        Izvedeno stanje: {tank.current_l.toFixed(0)} l. Razlika prema očitanom ide u audit trag —
        gubitak goriva se vidi samo iz razlike.
      </p>
      <Input label="Očitano stanje (l)" value={current} inputMode="decimal" onChange={(event) => setCurrent(event.target.value)} />
      <p className="gx-muted" aria-live="polite">
        Razlika: {difference >= 0 ? "+" : ""}{difference.toFixed(0)} l
      </p>
      <Input label="Napomena (opciono)" value={note} onChange={(event) => setNote(event.target.value)} />
    </Dialog>
  );
}

/**
 * Šifarnik cijena goriva (spec 05 §1.3.10).
 *
 * Cijena je po VRSTI goriva i DATUMU. Točenje predlaže najnoviju cijenu koja nije poslije datuma
 * točenja — cijena se mijenja rijetko, a točenja su svaki dan, pa tačan datum skoro nikad ne bi
 * postojao.
 */
export function FuelPricesPanel({ canManage }: { canManage: boolean }) {
  const [prices, setPrices] = useState<FuelPriceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiCall<{ prices: FuelPriceRow[] }>("/api/fuel-prices");
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPrices(res.data.prices);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <Alert tone="error" role="alert">{error}</Alert>;
  if (!prices) return <Skeleton rows={2} />;

  return (
    <Stack gap="var(--space-4)">
      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}
      {canManage ? (
        <div className="gx-inline-flex">
          <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>Nova cijena</Button>
        </div>
      ) : null}
      <DataTable
        caption="Cijene goriva"
        rows={prices}
        rowKey={(row) => row.id}
        columns={[
          { key: "kind", header: "Vrsta", cell: (row) => FUEL_KIND_LABELS[row.fuel_kind] ?? row.fuel_kind },
          { key: "price", header: "Cijena / l", cell: (row) => `${row.price} ${row.currency_code}` },
          { key: "from", header: "Važi od", cell: (row) => row.valid_from },
          { key: "supplier", header: "Dobavljač", cell: (row) => row.supplier_name ?? "—" },
        ]}
        empty={(
          <EmptyState
            title="Nema cijena"
            description="Bez šifarnika se cijena po litru upisuje ručno pri svakom točenju."
          />
        )}
      />
      {createOpen ? (
        <PriceDialog
          busy={busy}
          onBusy={setBusy}
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); setNotice("Cijena je upisana."); void load(); }}
          onError={setError}
        />
      ) : null}
    </Stack>
  );
}

const FUEL_KIND_LABELS: Record<string, string> = {
  DIESEL: "Dizel",
  PETROL: "Benzin",
  ADBLUE: "AdBlue",
  LPG: "LPG",
  OTHER: "Ostalo",
};

type FuelPriceRow = {
  id: string;
  fuel_kind: string;
  supplier_partner_id: string | null;
  supplier_name: string | null;
  price: string;
  currency_code: string;
  valid_from: string;
};

function PriceDialog({
  busy, onBusy, onClose, onDone, onError,
}: {
  busy: boolean;
  onBusy: (value: boolean) => void;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [fuelKind, setFuelKind] = useState("DIESEL");
  const [price, setPrice] = useState("");
  const [validFrom, setValidFrom] = useState(today);

  const submit = async () => {
    if (!/^\d+(\.\d{1,2})?$/.test(price.trim())) {
      onError("Cijena je decimalni broj (npr. 2.45).");
      return;
    }
    onBusy(true);
    const res = await apiCall<FuelPriceRow>("/api/fuel-prices", jsonBody({
      fuelKind,
      price: price.trim(),
      validFrom,
    }));
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    onDone();
  };

  return (
    <Dialog
      title="Nova cijena goriva"
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Otkaži</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>Sačuvaj</Button>
        </>
      )}
    >
      <Select label="Vrsta goriva" value={fuelKind} onChange={(event) => setFuelKind(event.target.value)}>
        {Object.entries(FUEL_KIND_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </Select>
      <Input label="Cijena po litru" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
      <Input label="Važi od" type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
    </Dialog>
  );
}

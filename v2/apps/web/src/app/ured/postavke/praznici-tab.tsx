"use client";

/**
 * Tab Praznici: kalendar neradnih dana i prenesenih radnih subota (spec 01 §3.3).
 *
 * „Radna subota“ je posebna vrsta reda, ne napomena: bez nje obračun sati ne zna da je
 * subota bila radna i taj dan pada kao prekovremeno.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall } from "@/api-client";
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  DataTable,
  EmptyState,
  FormGrid,
  FormSection,
  Input,
  Skeleton,
  Switch,
  type DataColumn,
} from "@/components/ui/index";

type Holiday = { id: string; date: string; name: string; isPaid: boolean; isWorking: boolean };

const dateFormat = new Intl.DateTimeFormat("bs-BA", { day: "2-digit", month: "2-digit", year: "numeric" });

export function PrazniciTab({ canManage }: { canManage: boolean }) {
  const year = new Date().getFullYear();
  const [rows, setRows] = useState<Holiday[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ date: "", name: "", isWorking: false });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await apiCall<{ holidays: Holiday[] }>(`/api/company/holidays?year=${year}`);
    if (result.ok) {
      setRows(result.data.holidays);
      setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setError(null);
    const result = await apiCall<{ holiday: Holiday }>("/api/company/holidays", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: form.date, name: form.name, isWorking: form.isWorking, isPaid: !form.isWorking }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setForm({ date: "", name: "", isWorking: false });
    void load();
  };

  const remove = async (id: string) => {
    const result = await apiCall<{ deleted: boolean }>(`/api/company/holidays/${id}`, { method: "DELETE" });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    void load();
  };

  const columns: DataColumn<Holiday>[] = [
    { key: "date", header: "Datum", cell: (row) => dateFormat.format(new Date(`${row.date}T00:00:00`)) },
    { key: "name", header: "Naziv", cell: (row) => row.name },
    {
      key: "kind",
      header: "Vrsta",
      cell: (row) =>
        row.isWorking ? <Badge tone="quiet">Radna subota</Badge> : <Chip>{row.isPaid ? "Plaćen praznik" : "Neradni dan"}</Chip>,
    },
  ];

  return (
    <Card>
      <FormSection title={`Praznici ${year}`}>
        {canManage ? (
          <FormGrid>
            <Input label="Datum" type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
            <Input label="Naziv" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="npr. Dan državnosti" />
            <Switch
              label="Prenesena radna subota (radi se)"
              checked={form.isWorking}
              onChange={(event) => setForm({ ...form, isWorking: event.target.checked })}
            />
            <Button onClick={() => void add()} disabled={busy || !form.date || !form.name.trim()}>
              Dodaj
            </Button>
          </FormGrid>
        ) : null}

        {error ? <Alert tone="error">
          <strong>Greška.</strong> {error}</Alert> : null}

        {loading ? (
          <Skeleton rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nema unesenih praznika"
            description="Bez praznika obračun sati računa svaki dan kao radni. Dodajte praznike i radne subote."
          />
        ) : (
          <DataTable
            caption={`Praznici ${year}`}
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            actions={
              canManage
                ? (row) => [{ key: "delete", label: "Ukloni", danger: true, onSelect: () => void remove(row.id) }]
                : undefined
            }
            rowActionLabel={(row) => `Radnje za ${row.name}`}
          />
        )}
      </FormSection>
    </Card>
  );
}


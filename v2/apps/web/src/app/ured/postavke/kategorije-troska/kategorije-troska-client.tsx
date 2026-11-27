"use client";

/**
 * Šifarnik kategorija troška.
 *
 * Mapiranje `default_for_source_type` je ono što automatsko knjiženje koristi da zna u koju
 * kategoriju ide radni dan, gorivo ili servis. Zato ekran pokazuje i NEMAPIRANE izvore: bez tog
 * upozorenja bi trošak otišao u „Ostalo“ i niko ne bi znao zašto.
 *
 * Kategorija koja se koristi ne briše se — deaktivira se (`is_active`), da stari troškovi ostanu
 * čitljivi.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Chip, DataTable, Dialog, EmptyState, Input, Select, Skeleton,
} from "@/components/ui/index";
import type { CategoriesResult, CategoryRow } from "@/server/project-budget-types";

const SOURCE_LABEL: Record<string, string> = {
  WORKDAY: "Radni dan",
  MACHINE_WORK_LOG: "Rad mašine",
  FUEL_ENTRY: "Gorivo",
  HAUL: "Prevoz",
  SERVICE_ORDER: "Servis",
  PURCHASE: "Nabavka",
  SUBCONTRACTOR: "Podizvođač",
  MANUAL: "Ručni unos",
};

type Form = {
  id?: string;
  code: string;
  name: string;
  sortOrder: string;
  defaultForSourceType: string;
  isActive: boolean;
};

const EMPTY: Form = { code: "", name: "", sortOrder: "0", defaultForSourceType: "", isActive: true };

export function KategorijeTroskaClient({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<CategoriesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const result = await apiCall<CategoriesResult>("/api/cost-categories");
    if (!result.ok) {
      setError(result.message);
      setData(null);
      return;
    }
    setData(result.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    const result = await apiCall<CategoryRow | { category: CategoryRow }>("/api/cost-categories", {
      ...jsonBody({
        ...(form.id ? { id: form.id } : {}),
        code: form.code.trim(),
        name: form.name.trim(),
        sortOrder: Number(form.sortOrder),
        defaultForSourceType: form.defaultForSourceType || null,
        isActive: form.isActive,
      }),
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setForm(null);
    setMessage("Kategorija je sačuvana. Automatsko knjiženje je koristi od sljedećeg zapisa.");
    await load();
  }

  if (error && data === null) return <Alert tone="error">{error}</Alert>;
  if (data === null) return <Skeleton rows={5} />;

  return (
    <div className="gx-stack">
      <h1 className="gx-page-title">Kategorije troška</h1>
      <p className="gx-page-sub">
        Kategorija određuje gdje trošak pada u budžetu i po čemu se porede projekti. Kategorija koja
        se koristi ne briše se — deaktivira se, da stari troškovi ostanu čitljivi.
      </p>

      {message ? <Alert tone="success" role="status">{message}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {data.unmapped_sources.length > 0 ? (
        <Alert tone="warning" role="status">
          Ovi izvori još nemaju podrazumijevanu kategoriju i padaju u „Ostalo“:{" "}
          {data.unmapped_sources.map((source) => SOURCE_LABEL[source] ?? source).join(", ")}.
        </Alert>
      ) : null}

      {canManage ? (
        <div className="gx-inline-flex">
          <Button variant="primary" onClick={() => setForm({ ...EMPTY })}>
            + Nova kategorija
          </Button>
        </div>
      ) : null}

      {data.categories.length === 0 ? (
        <EmptyState
          title="Nema kategorija"
          description="Bez kategorija automatsko knjiženje ne zna gdje trošak pada. Dodajte ih prije prvog knjiženja."
        />
      ) : (
        <DataTable
          caption="Kategorije troška"
          rows={data.categories}
          rowKey={(category) => category.id}
          emptyText="Nema kategorija."
          columns={[
            {
              key: "category",
              header: "Kategorija",
              cell: (category) => (
                <span className="gx-stack gx-stack--2">
                  <span>{category.name}</span>
                  <span className="gx-page-sub">{category.code}</span>
                </span>
              ),
            },
            { key: "sort", header: "Redoslijed", numeric: true, cell: (category) => String(category.sort_order) },
            {
              key: "mapping",
              header: "Podrazumijeva za izvor",
              cell: (category) =>
                category.default_for_source_type === null ? (
                  <span className="gx-page-sub">—</span>
                ) : (
                  SOURCE_LABEL[category.default_for_source_type] ?? category.default_for_source_type
                ),
            },
            {
              key: "usage",
              header: "Upotreba",
              numeric: true,
              cell: (category) => `${category.usage_count} linija budžeta`,
            },
            {
              key: "active",
              header: "Stanje",
              cell: (category) => (
                <Chip tone={category.is_active ? "hollow" : "hot"}>
                  {category.is_active ? "aktivna" : "neaktivna"}
                </Chip>
              ),
            },
          ]}
          rowActionLabel={(category) => `Više radnji za kategoriju ${category.name}`}
          actions={(category) =>
            canManage
              ? [
                  {
                    key: "edit",
                    label: "Izmijeni kategoriju",
                    onSelect: () =>
                      setForm({
                        id: category.id,
                        code: category.code,
                        name: category.name,
                        sortOrder: String(category.sort_order),
                        defaultForSourceType: category.default_for_source_type ?? "",
                        isActive: category.is_active,
                      }),
                  },
                ]
              : []
          }
        />
      )}

      {form ? (
        <Dialog
          title={form.id ? "Izmjena kategorije" : "Nova kategorija"}
          hint="Šifra se ne mijenja poslije prvog knjiženja — na njoj se bazira poređenje između projekata."
          returnFocusTo={null}
          onClose={() => setForm(null)}
        >
          <form className="gx-stack" onSubmit={submit}>
            <Input
              label="Šifra"
              required
              maxLength={30}
              disabled={Boolean(form.id)}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
            <Input
              label="Naziv"
              required
              maxLength={80}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <Input
              label="Redoslijed"
              type="number"
              min={0}
              value={form.sortOrder}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            />
            <Select
              label="Podrazumijeva za izvor"
              hint="Ovaj izvor automatski pada u ovu kategoriju ako projekat ne naloži drugačije."
              value={form.defaultForSourceType}
              onChange={(event) => setForm({ ...form, defaultForSourceType: event.target.value })}
            >
              <option value="">— nije mapirano —</option>
              {Object.entries(SOURCE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              label="Stanje"
              value={form.isActive ? "1" : "0"}
              onChange={(event) => setForm({ ...form, isActive: event.target.value === "1" })}
            >
              <option value="1">Aktivna</option>
              <option value="0">Neaktivna</option>
            </Select>
            <div className="gx-inline-flex gx-mt-2">
              <Button variant="quiet" onClick={() => setForm(null)}>
                Otkaži
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                Sačuvaj kategoriju
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

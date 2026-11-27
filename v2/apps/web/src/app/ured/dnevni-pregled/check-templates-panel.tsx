"use client";

/**
 * F4 (Modul 5 §1.5.20) — šabloni dnevnog pregleda.
 *
 * Šablon definiše stavke i koje su KRITIČNE. Kritična `FAIL` stavka traži fotografiju i otvara
 * kvar; bez šablona „kritično" ne postoji kao pojam, pa svaki nalaz ima istu težinu.
 *
 * Jedan aktivan šablon po kategoriji: novi aktivan automatski gasi prethodni (servis to radi) —
 * dva aktiva bi značila da rukovalac ne zna koji je „pravi".
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import {
  Alert, Button, Checkbox, DataTable, Dialog, EmptyState, Input, Select, Skeleton, Stack,
} from "@/components/ui/index";

type Item = { key: string; label: string; required: boolean; critical: boolean };

type Template = {
  id: string;
  category_id: string | null;
  category_name: string | null;
  name: string;
  items: Item[];
  is_active: boolean;
};

type Category = { id: string; code: string; name: string };

export function CheckTemplatesPanel({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<Template[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [templates, cats] = await Promise.all([
      apiCall<{ templates: Template[] }>("/api/check-templates?includeInactive=1"),
      apiCall<{ categories: Category[] }>("/api/equipment-categories"),
    ]);
    if (!templates.ok) {
      setError(templates.message);
      return;
    }
    setRows(templates.data.templates);
    if (cats.ok) setCategories(cats.data.categories);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <Alert tone="error" role="alert">{error}</Alert>;
  if (!rows) return <Skeleton rows={2} />;

  return (
    <Stack gap="var(--space-4)">
      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}
      {canManage ? (
        <div className="gx-inline-flex">
          <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Novi šablon</Button>
        </div>
      ) : null}
      <DataTable
        caption="Šabloni pregleda"
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          { key: "name", header: "Šablon", cell: (row) => row.name },
          { key: "category", header: "Kategorija", cell: (row) => row.category_name ?? "Sve mašine" },
          { key: "items", header: "Stavke", cell: (row) => String(row.items.length) },
          {
            key: "critical",
            header: "Kritične",
            cell: (row) => String(row.items.filter((item) => item.critical).length),
          },
          { key: "active", header: "Aktivan", cell: (row) => (row.is_active ? "da" : "ne") },
          {
            key: "actions",
            header: "",
            cell: (row) => (canManage ? (
              <Button variant="quiet" onClick={() => setEditing(row)}>Izmijeni</Button>
            ) : null),
          },
        ]}
        empty={(
          <EmptyState
            title="Nema šablona"
            description="Bez šablona pregled je slobodan — nema kritičnih stavki, pa nema ni auto-kvara."
          />
        )}
      />
      {editing ? (
        <TemplateDialog
          template={editing === "new" ? null : editing}
          categories={categories}
          busy={busy}
          onBusy={setBusy}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); setNotice("Šablon je sačuvan."); void load(); }}
          onError={setError}
        />
      ) : null}
    </Stack>
  );
}

function TemplateDialog({
  template, categories, busy, onBusy, onClose, onDone, onError,
}: {
  template: Template | null;
  categories: Category[];
  busy: boolean;
  onBusy: (value: boolean) => void;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [categoryId, setCategoryId] = useState(template?.category_id ?? "");
  const [items, setItems] = useState<Item[]>(
    template?.items ?? [{ key: "ulje", label: "Nivo ulja", required: true, critical: true }],
  );

  const update = (index: number, patch: Partial<Item>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const submit = async () => {
    if (!name.trim()) {
      onError("Naziv šablona je obavezan.");
      return;
    }
    if (items.length === 0) {
      onError("Šablon mora imati najmanje jednu stavku.");
      return;
    }
    const keys = new Set<string>();
    for (const item of items) {
      // Isti ključ dvaput bi u rezultatu pregleda tiho pregazio jedan drugi nalaz.
      if (!item.key.trim() || !item.label.trim()) {
        onError("Svaka stavka ima ključ i naziv.");
        return;
      }
      if (keys.has(item.key.trim())) {
        onError(`Ključ „${item.key.trim()}" se ponavlja.`);
        return;
      }
      keys.add(item.key.trim());
    }
    onBusy(true);
    const body = {
      id: template?.id,
      name: name.trim(),
      categoryId: categoryId || null,
      items: items.map((item) => ({ ...item, key: item.key.trim(), label: item.label.trim() })),
    };
    const res = await apiCall<Template>(
      "/api/check-templates",
      template ? patchBody(body) : jsonBody(body),
    );
    onBusy(false);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    onDone();
  };

  return (
    <Dialog
      title={template ? "Izmjena šablona" : "Novi šablon pregleda"}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Otkaži</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>Sačuvaj</Button>
        </>
      )}
    >
      <Input label="Naziv šablona" value={name} onChange={(event) => setName(event.target.value)} />
      <Select label="Kategorija mašine" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
        <option value="">Sve mašine (rezervni šablon)</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>{category.name}</option>
        ))}
      </Select>
      <p className="gx-muted">
        Kritična stavka na kojoj se upiše „nije prošlo" traži fotografiju i otvara kvar.
      </p>
      {items.map((item, index) => (
        <div key={index} className="gx-card">
          <Input
            label={`Ključ stavke ${index + 1}`}
            value={item.key}
            onChange={(event) => update(index, { key: event.target.value })}
            hint="Kratko, bez razmaka (npr. ulje, gume, kočnice)"
          />
          <Input
            label="Naziv stavke"
            value={item.label}
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <div className="gx-inline-flex">
            <Checkbox
              label="Obavezna"
              checked={item.required}
              onChange={(event) => update(index, { required: event.target.checked })}
            />
            <Checkbox
              label="Kritična"
              checked={item.critical}
              onChange={(event) => update(index, { critical: event.target.checked })}
            />
            <Button
              variant="quiet"
              onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
            >
              Ukloni stavku
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="secondary"
        icon="plus"
        onClick={() => setItems((current) => [
          ...current,
          { key: `stavka${current.length + 1}`, label: "", required: true, critical: false },
        ])}
      >
        Dodaj stavku
      </Button>
    </Dialog>
  );
}

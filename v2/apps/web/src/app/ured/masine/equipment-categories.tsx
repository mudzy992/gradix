"use client";

/** Kategorije mašina: nose vrstu brojila i mapiranje iz Excela. */
import { useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { meterUnit } from "@/format";
import { Alert, Button, DataTable, Dialog, Input, Mono, SectionTitle, Select } from "@/components/ui/index";
import type { CategoryRow } from "./equipment-shared";

export function CategoriesDialog({
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
      <div className="gx-stack gx-stack--5 gx-mt-5">
        {categories.length === 0 ? (
          <Alert tone="info">Još nema kategorija — dodajte prvu ispod.</Alert>
        ) : (
          <DataTable
            caption="Kategorije mašina"
            rows={categories}
            rowKey={(category) => category.id}
            emptyText="Još nema kategorija."
            columns={[
              { key: "name", header: "Naziv", cell: (category) => category.name },
              { key: "code", header: "Oznaka", cell: (category) => <Mono>{category.code}</Mono> },
              { key: "meter", header: "Brojilo", cell: (category) => meterUnit(category.meter) },
              { key: "count", header: "Mašina", numeric: true, cell: (category) => <Mono>{category.machineCount}</Mono> },
            ]}
          />
        )}

        <form onSubmit={add} className="gx-stack">
          <SectionTitle hint="Nova kategorija vrijedi za cijelu firmu.">Dodaj kategoriju</SectionTitle>
          {error ? (
            <Alert tone="error" role="alert">
              {error}
            </Alert>
          ) : null}
          <div className="gx-cols">
            <Input label="Naziv" id="category-name" value={name} onChange={(event) => setName(event.target.value)} />
            <Input label="Oznaka" hint="Velika slova, bez razmaka. Koristi se u uvozu." id="category-code" value={code} onChange={(event) => setCode(event.target.value)} />
            <Select label="Brojilo"id="category-meter"
                value={meter}
                onChange={(event) => setMeter(event.target.value)}
              >
                <option value="HOURS">Sati</option>
                <option value="KM">Kilometri</option>
              </Select>
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

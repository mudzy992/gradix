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
import { useCallback, useEffect, useMemo, useState } from "react";

export type { CategoryRow, MachineRow } from "./equipment-shared";
import type { CategoryRow, MachineRow } from "./equipment-shared";
import { apiCall, patchBody } from "@/api-client";
import { formatDateTime, formatNumber, meterUnit, ownershipLabel } from "@/format";
import {
  Alert, Button, Card, Checkbox, Chip, DataTable, EmptyState, FilterBar, Input, Mono,
  PageHeader, Select, Skeleton,
} from "@/components/ui/index";
import { MachineDialog, MeterDialog } from "./equipment-dialogs";
import { CategoriesDialog } from "./equipment-categories";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; machines: MachineRow[]; categories: CategoryRow[] };




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
      <PageHeader
        title="Mašine i vozila"
        subtitle="Inventar firme, kategorije i trenutno stanje brojila. Historija očitanja dolazi u R5."
        actions={canManage ? (
          <>
            <Button onClick={() => setCategoriesOpen(true)}>Kategorije</Button>
            <Button
              variant="primary"
              icon="folder"
              onClick={(event) => setEditing({ machine: null, returnTo: event.currentTarget })}
            >
              + Dodaj mašinu
            </Button>
          </>
        ) : null}
      />

      {message ? (
        <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </Alert>
      ) : null}

      <Card>
        <FilterBar>
          <Input label="Traži mašinu" id="equipment-filter" placeholder="Oznaka, naziv, tablice" value={filter} onChange={(event) => setFilter(event.target.value)} />
          <Select label="Kategorija"id="equipment-category"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="">Sve kategorije</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          <Checkbox label={`Prikaži i neaktivne (${inactiveCount})`} id="equipment-show-inactive" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
        </FilterBar>

        {state.kind === "loading" ? <Skeleton rows={4} /> : null}

        {state.kind === "error" ? (
          <div className="gx-stack">
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
          <DataTable
            caption="Mašine i vozila"
            rows={visible}
            rowKey={(machine) => machine.id}
            emptyText="Nema mašina koje odgovaraju filteru."
            columns={[
              {
                key: "machine",
                header: "Mašina",
                cell: (machine) => (
                  <div className="gx-who">
                    <Mono>{machine.code}</Mono> {machine.name}
                    <span>{[machine.make, machine.model, machine.plate, machine.year].filter(Boolean).join(" · ") || "—"}</span>
                  </div>
                ),
              },
              { key: "category", header: "Kategorija", cell: (machine) => machine.categoryName },
              {
                key: "meter",
                header: "Brojilo",
                cell: (machine) => (
                  <div className="gx-stack gx-stack--2">
                    <span className="gx-mono">
                      {machine.meterValue === null ? "—" : `${formatNumber(machine.meterValue)} ${meterUnit(machine.meter)}`}
                    </span>
                    <span className="gx-page-sub">
                      {machine.meterUpdatedAt ? `upisano ${formatDateTime(machine.meterUpdatedAt)}` : "bez upisa"}
                    </span>
                  </div>
                ),
              },
              { key: "ownership", header: "Vlasništvo", cell: (machine) => ownershipLabel(machine.ownership) },
              { key: "status", header: "Status", cell: (machine) => <Chip tone={machine.isActive ? "full" : "hollow"}>{machine.isActive ? "Aktivna" : "Neaktivna"}</Chip> },
            ]}
            rowActionLabel={(machine) => `Više radnji za ${machine.code}`}
            actions={(machine) =>
              canManage
                ? [
                    { key: "meter", label: "Upisi brojilo", onSelect: (returnTo) => setMeterFor({ machine, returnTo: returnTo ?? null }) },
                    { key: "edit", label: "Izmijeni mašinu", onSelect: (returnTo) => setEditing({ machine, returnTo: returnTo ?? null }) },
                    { key: "toggle", label: machine.isActive ? "Deaktiviraj" : "Aktiviraj", danger: true, onSelect: () => void toggleActive(machine) },
                  ]
                : [
                    { key: "meter", label: "Upisi brojilo", onSelect: (returnTo) => setMeterFor({ machine, returnTo: returnTo ?? null }) },
                  ]
            }
          />
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

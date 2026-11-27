"use client";

/**
 * F8 — dijelovi: katalog, stanje i ručne kretnje.
 *
 * Stanje se prikazuje sa tri decimale (metar, kilogram, litar su česte jedinice), a minimum sa
 * istom preciznošću — inače bi „min 2“ i „stanje 1,999“ izgledali kao da su jednaki.
 *
 * Popis (`COUNT`) se unosi kao IZBROJANO stanje, a sistem upisuje razliku kao kretnju. Da se
 * upisuje novo stanje direktno, popis bi bio drugi izvor istine pored kretnji i prva razlika ne bi
 * imala objašnjenje.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  FormGrid,
  FormSection,
  Input,
  Select,
  Stack,
} from "@/components/ui/index";

type StockItemRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  min_quantity: string;
  on_hand: string;
  below_minimum: boolean;
  last_unit_cost_amount: string | null;
  is_active: boolean;
};

type MovementRow = {
  id: string;
  item_code: string;
  item_name: string;
  kind: string;
  quantity: string;
  unit_cost_amount: string | null;
  occurred_on: string;
  note: string | null;
};

const KIND_LABEL: Record<string, string> = { IN: "Primanje", OUT: "Izdavanje", TRANSFER: "Prenos", COUNT: "Popis" };

export function DijeloviClient({
  initialItems,
  caps,
}: {
  initialItems: StockItemRow[];
  caps: { canManage: boolean; canViewMovements: boolean };
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [onlyBelow, setOnlyBelow] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newItem, setNewItem] = useState({ code: "", name: "", unit: "kom", minQuantity: "0" });
  const [movement, setMovement] = useState({ itemId: "", kind: "IN", quantity: "", unitCostAmount: "" });
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [movements, setMovements] = useState<MovementRow[]>([]);

  useEffect(() => setItems(initialItems), [initialItems]);

  const loadMovements = useCallback(async (itemId: string) => {
    const result = await apiCall<{ movements: MovementRow[] }>(`/api/stock-movements?item=${itemId}&limit=100`);
    if (result.ok) setMovements(result.data.movements);
  }, []);

  useEffect(() => {
    if (selectedItem) void loadMovements(selectedItem);
    else setMovements([]);
  }, [loadMovements, selectedItem]);

  const rows = useMemo(
    () => (onlyBelow ? items.filter((item) => item.below_minimum) : items),
    [items, onlyBelow],
  );

  const createItem = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall<{ id: string }>(
      "/api/stock-items",
      jsonBody({
        code: newItem.code,
        name: newItem.name,
        unit: newItem.unit || "kom",
        minQuantity: newItem.minQuantity || "0",
      }),
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({ tone: "success", text: "Artikal je dodan." });
    setNewItem({ code: "", name: "", unit: "kom", minQuantity: "0" });
    router.refresh();
  };

  const postMovement = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall<{ onHand: string; belowMinimum: boolean }>(
      "/api/stock-movements",
      jsonBody({
        itemId: movement.itemId,
        kind: movement.kind,
        quantity: movement.quantity,
        ...(movement.unitCostAmount ? { unitCostAmount: movement.unitCostAmount } : {}),
      }),
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({
      tone: result.data.belowMinimum ? "error" : "success",
      text: result.data.belowMinimum
        ? `Kretnja je proknjižena. Stanje ${result.data.onHand} je ISPOD minimuma — upozorenje, ne blokada.`
        : `Kretnja je proknjižena. Stanje ${result.data.onHand}.`,
    });
    setMovement({ ...movement, quantity: "", unitCostAmount: "" });
    router.refresh();
    if (selectedItem) void loadMovements(selectedItem);
  };

  const toggleItem = async (item: StockItemRow) => {
    setBusy(true);
    const result = await apiCall<{ id: string }>(`/api/stock-items/${item.id}`, patchBody({ isActive: !item.is_active }));
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setItems(items.map((row) => (row.id === item.id ? { ...row, is_active: !row.is_active } : row)));
  };

  return (
    <Stack gap="var(--space-5)">
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}

      <Card>
        <FormSection title="Artikli">
          <Stack gap="var(--space-3)">
            <Checkbox
              label="Samo ispod minimuma"
              checked={onlyBelow}
              onChange={(event) => setOnlyBelow(event.target.checked)}
            />
            <DataTable
              caption="Artikli na zalihama"
              rows={rows}
              rowKey={(row) => row.id}
              emptyText="Nema artikala."
              columns={[
                { key: "code", header: "Šifra", cell: (row) => row.code },
                { key: "name", header: "Naziv", cell: (row) => row.name },
                { key: "onHand", header: "Stanje", numeric: true, cell: (row) => `${row.on_hand} ${row.unit}` },
                { key: "min", header: "Minimum", numeric: true, cell: (row) => `${row.min_quantity} ${row.unit}` },
                {
                  key: "status",
                  header: "Stanje",
                  cell: (row) => (row.below_minimum ? "Ispod minimuma" : row.is_active ? "Aktivno" : "Neaktivno"),
                },
                {
                  key: "actions",
                  header: "",
                  cell: (row) => (
                    <Stack gap="var(--space-1)">
                      <Button variant="quiet" onClick={() => setSelectedItem(row.id)}>
                        Kretnje
                      </Button>
                      {caps.canManage ? (
                        <Button variant="quiet" disabled={busy} onClick={() => void toggleItem(row)}>
                          {row.is_active ? "Isključi" : "Uključi"}
                        </Button>
                      ) : null}
                    </Stack>
                  ),
                },
              ]}
            />
          </Stack>

          {caps.canManage ? (
            <FormGrid>
              <Input label="Šifra" value={newItem.code} onChange={(event) => setNewItem({ ...newItem, code: event.target.value })} />
              <Input label="Naziv" value={newItem.name} onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} />
              <Input label="Jedinica" value={newItem.unit} onChange={(event) => setNewItem({ ...newItem, unit: event.target.value })} />
              <Input
                label="Minimum"
                inputMode="decimal"
                value={newItem.minQuantity}
                onChange={(event) => setNewItem({ ...newItem, minQuantity: event.target.value })}
              />
            </FormGrid>
          ) : null}
          {caps.canManage ? (
            <Button variant="secondary" disabled={busy || !newItem.code || !newItem.name} onClick={() => void createItem()}>
              Dodaj artikal
            </Button>
          ) : null}
        </FormSection>
      </Card>

      {caps.canManage ? (
        <Card>
          <FormSection title="Kretnja">
            <FormGrid>
              <Select
                label="Artikal"
                value={movement.itemId}
                onChange={(event) => setMovement({ ...movement, itemId: event.target.value })}
              >
                <option value="">Izaberite artikal</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
                ))}
              </Select>
              <Select
                label="Vrsta"
                value={movement.kind}
                onChange={(event) => setMovement({ ...movement, kind: event.target.value })}
              >
                <option value="IN">Primanje</option>
                <option value="OUT">Izdavanje</option>
                <option value="COUNT">Popis (izbrojano stanje)</option>
              </Select>
              <Input
                label={movement.kind === "COUNT" ? "Izbrojano stanje" : "Količina"}
                inputMode="decimal"
                value={movement.quantity}
                onChange={(event) => setMovement({ ...movement, quantity: event.target.value })}
              />
              <Input
                label="Cijena po jedinici (KM)"
                inputMode="decimal"
                value={movement.unitCostAmount}
                onChange={(event) => setMovement({ ...movement, unitCostAmount: event.target.value })}
              />
            </FormGrid>
            <Button
              variant="secondary"
              disabled={busy || !movement.itemId || !movement.quantity}
              onClick={() => void postMovement()}
            >
              Proknjiži kretnju
            </Button>
          </FormSection>
        </Card>
      ) : null}

      {selectedItem && caps.canViewMovements ? (
        <Card>
          <FormSection title="Kretnje izabranog artikla">
            <DataTable
              caption="Kretnje zaliha"
              rows={movements}
              rowKey={(row) => row.id}
              emptyText="Nema kretnji."
              columns={[
                { key: "date", header: "Datum", cell: (row) => row.occurred_on },
                { key: "kind", header: "Vrsta", cell: (row) => KIND_LABEL[row.kind] ?? row.kind },
                { key: "qty", header: "Količina", numeric: true, cell: (row) => row.quantity },
                { key: "cost", header: "Cijena", numeric: true, cell: (row) => row.unit_cost_amount ?? "—" },
                { key: "note", header: "Napomena", cell: (row) => row.note ?? "—" },
              ]}
            />
          </FormSection>
        </Card>
      ) : null}
    </Stack>
  );
}

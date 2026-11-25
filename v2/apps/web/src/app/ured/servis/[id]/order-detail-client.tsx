"use client";

/**
 * F8 — detalj naloga: tok, dijelovi, trošak, odobrenje, garancija.
 *
 * Pravilo ekrana: **trošak je prikaz, ne unos.** `labor/parts/external/total` se ne mogu kucati
 * — nastaju iz sati, dijelova i vanjskog računa. Ako bi polje za `total` postojalo, prvo što bi
 * neko uradio je da ga prepiše, pa ledger i nalog ne bi govorili isto.
 *
 * Dijelovi se dodaju iz ŠIFARNIKA (padajuća lista sa stanjem), jer mehaničar zna šta mu treba, a
 * ne šifru artikla; stanje se vidi prije izbora, pa se ne izdaje ono čega nema.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert,
  Button,
  Card,
  DataTable,
  DescriptionList,
  FormGrid,
  FormSection,
  Input,
  Select,
  Stack,
  Stat,
  StatusDot,
  Tabs,
} from "@/components/ui/index";
import type { ServiceOrderDetail, ServiceOrderPartRow } from "@/server/service-order-types";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_TONE, formatDuration, money } from "../servis-shared";

type StockOption = { id: string; code: string; name: string; unit: string; onHand: string };
type Caps = { canManage: boolean; canApprove: boolean; canStock: boolean };

export function OrderDetailClient({
  detail,
  stockItems,
  caps,
}: {
  detail: ServiceOrderDetail;
  stockItems: StockOption[];
  caps: Caps;
}) {
  const router = useRouter();
  const order = detail.order;
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [laborHours, setLaborHours] = useState(order.labor_hours === "0.00" ? "" : order.labor_hours);
  const [externalAmount, setExternalAmount] = useState("");
  const [warrantyUntil, setWarrantyUntil] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [rejectReason, setRejectReason] = useState("");
  /* Preklop je stanje EKRANA, ne ruta: isti nalog se gleda kroz dijelove, tok i trošak bez
     ponovnog učitavanja — a `Tabs` komponenta prima `active`/`onChange`, ne sadržaj. */
  const [tab, setTab] = useState("parts");

  const call = async (url: string, init: RequestInit, successText: string) => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall<{ outcome: string; message?: string }>(url, init);
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return false;
    }
    setNotice({ tone: "success", text: successText });
    router.refresh();
    return true;
  };

  const isOpen = order.status !== "DONE" && order.status !== "CANCELLED";

  return (
    <Stack gap="var(--space-5)">
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}

      <Card>
        <Stack gap="var(--space-4)">
          <DescriptionList
            items={[
              {
                term: "Stanje",
                value: <StatusDot tone={STATUS_TONE[order.status] ?? "muted"} label={STATUS_LABEL[order.status] ?? order.status} />,
              },
              { term: "Prioritet", value: PRIORITY_LABEL[order.priority] ?? order.priority },
              { term: "Porijeklo", value: order.origin },
              { term: "Mehaničar", value: order.assigned_mechanic_name ?? "—" },
              { term: "Projekat", value: order.project_code ?? "— (samo mašina)" },
              { term: "Vanjski servis", value: order.partner_name ?? "—" },
              { term: "Otvoren", value: order.opened_at.slice(0, 10) },
              { term: "Zastoj", value: formatDuration(order.downtime_minutes) },
              {
                term: "Garancija na rad",
                value: order.warranty_until ?? "—",
              },
              {
                term: "Reklamacija",
                value: order.warranty_claim ? "Da — bez novog troška" : "Ne",
              },
            ]}
          />

          <FormGrid>
            <Stat label="Rad" value={money(order.labor_cost_amount, order.currency_code)} hint={`${order.labor_hours} h`} />
            <Stat label="Dijelovi" value={money(order.parts_cost_amount, order.currency_code)} />
            <Stat label="Vanjski" value={money(order.external_cost_amount, order.currency_code)} />
            <Stat
              label="Ukupno"
              value={money(order.total_cost_amount, order.currency_code)}
              hint="Zbir tri komponente — nikad ručno"
            />
          </FormGrid>

          {caps.canManage && isOpen ? (
            <Stack gap="var(--space-3)">
              <FormSection title="Završetak rada">
                <FormGrid>
                  <Input
                    label="Sati mehaničara"
                    inputMode="decimal"
                    value={laborHours}
                    onChange={(event) => setLaborHours(event.target.value)}
                    hint="Satnica se čita iz evidencije na dan početka rada."
                  />
                  <Input
                    label="Vanjski trošak (KM)"
                    inputMode="decimal"
                    value={externalAmount}
                    onChange={(event) => setExternalAmount(event.target.value)}
                  />
                  <Input
                    label="Garancija do"
                    type="date"
                    value={warrantyUntil}
                    onChange={(event) => setWarrantyUntil(event.target.value)}
                  />
                </FormGrid>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() =>
                    void call(
                      `/api/service-orders/${order.id}/finish`,
                      jsonBody({
                        ...(laborHours ? { laborHours } : {}),
                        ...(externalAmount ? { externalCostAmount: externalAmount } : {}),
                        ...(warrantyUntil ? { warrantyUntil } : {}),
                      }),
                      "Nalog je završen; trošak je proknjižen.",
                    )
                  }
                >
                  Završi nalog i proknjiži trošak
                </Button>
              </FormSection>

              {order.status === "IN_PROGRESS" ? (
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => void call(`/api/service-orders/${order.id}/wait-parts`, jsonBody({}), "Nalog čeka dijelove.")}
                >
                  Rad staje — čeka dijelove
                </Button>
              ) : null}

              {order.status === "PLANNED" || order.status === "APPROVED" || order.status === "WAITING_PARTS" ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void call(`/api/service-orders/${order.id}/start`, jsonBody({}), "Rad je počeo.")}
                >
                  {order.status === "WAITING_PARTS" ? "Nastavi rad" : "Počni rad"}
                </Button>
              ) : null}
            </Stack>
          ) : null}

          {caps.canApprove && order.approval_status === "OPEN" ? (
            <FormSection title="Odobrenje troška">
              <Stack gap="var(--space-3)">
                <Input
                  label="Razlog odbijanja (ako odbijate)"
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  hint="Najmanje 10 znakova — odbijen nalog se otkazuje sa razlogom."
                />
                <Stack gap="var(--space-2)">
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => void call(`/api/service-orders/${order.id}/approve`, jsonBody({}), "Nalog je odobren.")}
                  >
                    Odobri
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy || rejectReason.trim().length < 10}
                    onClick={() =>
                      void call(`/api/service-orders/${order.id}/reject`, jsonBody({ reason: rejectReason }), "Nalog je odbijen.")
                    }
                  >
                    Odbij
                  </Button>
                </Stack>
              </Stack>
            </FormSection>
          ) : null}
        </Stack>
      </Card>

      <Tabs
        label="Dijelovi, tok i trošak naloga"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "parts", label: `Dijelovi (${detail.parts.length})` },
          { key: "events", label: `Tok (${detail.events.length})` },
          { key: "cost", label: "Trošak" },
        ]}
      />
      {tab === "parts" ? (
        <Stack gap="var(--space-4)">
          {caps.canManage && isOpen && caps.canStock ? (
            <Card>
              <FormSection title="Utrošak dijela">
                <FormGrid>
                  <Select label="Artikal" value={itemId} onChange={(event) => setItemId(event.target.value)}>
                    <option value="">Izaberite artikal</option>
                    {stockItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} — {item.name} (stanje {item.onHand} {item.unit})
                      </option>
                    ))}
                  </Select>
                  <Input
                    label="Količina"
                    inputMode="decimal"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </FormGrid>
                <Button
                  variant="secondary"
                  disabled={busy || !itemId || !quantity}
                  onClick={() =>
                    void call(
                      `/api/service-orders/${order.id}/parts`,
                      jsonBody({ itemId, quantity }),
                      "Dio je izdat sa zaliha; trošak je uvećan.",
                    )
                  }
                >
                  Izdaj dio
                </Button>
              </FormSection>
            </Card>
          ) : null}
          <DataTable<ServiceOrderPartRow>
            caption="Utrošeni dijelovi"
            rows={detail.parts}
            rowKey={(row) => row.id}
            emptyText="Nema utrošenih dijelova."
            columns={[
              { key: "item", header: "Artikal", cell: (row) => `${row.item_code} — ${row.item_name}` },
              { key: "qty", header: "Količina", numeric: true, cell: (row) => `${row.quantity} ${row.unit}` },
              { key: "unit", header: "Cijena", numeric: true, cell: (row) => money(row.unit_cost_amount, order.currency_code) },
              { key: "total", header: "Iznos", numeric: true, cell: (row) => money(row.total_cost_amount, order.currency_code) },
              { key: "note", header: "Napomena", cell: (row) => row.note ?? "—" },
            ]}
          />
        </Stack>
      ) : null}

      {tab === "events" ? (
        <DataTable<ServiceOrderDetail["events"][number]>
          caption="Tok naloga"
          rows={detail.events}
          rowKey={(row) => row.id}
          emptyText="Nema zapisa toka."
          columns={[
            { key: "at", header: "Kada", cell: (row) => row.at.slice(0, 16).replace("T", " ") },
            { key: "kind", header: "Događaj", cell: (row) => row.kind },
            { key: "actor", header: "Ko", cell: (row) => row.actor_name ?? "—" },
            { key: "note", header: "Napomena", cell: (row) => row.note ?? "—" },
          ]}
        />
      ) : null}

      {tab === "cost" ? (
        detail.costEntry ? (
          <DescriptionList
            items={[
              { term: "Red u ledgeru", value: detail.costEntry.id },
              {
                term: "Iznos",
                value: detail.costEntry.amount_amount
                  ? money(detail.costEntry.amount_amount, order.currency_code)
                  : "Nepoznat (PENDING)",
              },
              { term: "Nosilac", value: detail.costEntry.project_id ? "Projekat" : "Samo mašina" },
              { term: "Status", value: detail.costEntry.status },
            ]}
          />
        ) : (
          <Alert tone="info" role="status">
            Trošak se knjiži završetkom naloga. Do tada ga nema u ledgeru — planiranje je besplatno.
          </Alert>
        )
      ) : null}
    </Stack>
  );
}

"use client";

import { useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Chip, DataTable, DescriptionList, Inline, Input, Mono, Select, Stack, Textarea,
} from "@/components/ui/index";
import type {
  TenderBoqItemRow,
  TenderCalculation,
  TenderPriceRevisionRow,
  TenderResourceRow,
} from "@gradix/contracts";
import {
  APPROVAL_REASON_LABEL,
  RESOURCE_LABEL,
} from "../tenders-shared";

/**
 * Tab „Kalkulacija“: predmjer + resursi + marža + revizije.
 *
 * Ključno pravilo na ekranu: ponuda se NE prepisuje — dugme je „Nova revizija“, a polja
 * marže/rezerve/popusta su ulaz u obračun. Ako revizija traži odobrenje, to piše velikim
 * slovima i cijena se ne smije poslati (spec 08 §1.3/13).
 *
 * Tab se prikazuje SAMO onome sa `tenders.price.manage`; ACCOUNTANT dobija obavještenje u
 * roditeljskoj komponenti, ne praznu tabelu koja izgleda kao da podataka nema.
 */
export function TenderCalculationTab({
  tenderId,
  initialCalculation,
  initialBoq,
  initialResources,
  initialRevisions,
  caps,
}: {
  tenderId: string;
  initialCalculation: TenderCalculation | null;
  initialBoq: TenderBoqItemRow[];
  initialResources: TenderResourceRow[];
  initialRevisions: TenderPriceRevisionRow[];
  caps: { canPrice: boolean; canApprovePrice: boolean };
}) {
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [boq, setBoq] = useState(initialBoq);
  const [resources, setResources] = useState(initialResources);
  const [revisions, setRevisions] = useState(initialRevisions);
  const [calculation, setCalculation] = useState(initialCalculation);
  const [params, setParams] = useState({
    markupPct: initialCalculation?.markupPct ?? "0.00",
    riskReservePct: initialCalculation?.riskReservePct ?? "0.00",
    discountPct: initialCalculation?.discountPct ?? "0.00",
    reason: "",
  });
  const [newItem, setNewItem] = useState({
    code: "", description: "", unit: "kom", quantity: "1.000", unitCostAmount: "0.00",
  });
  const [newResource, setNewResource] = useState({
    kind: "LABOR", description: "", quantity: "1.000", unit: "h", unitCostAmount: "0.00",
  });

  const recompute = async (next = params) => {
    const query = new URLSearchParams({
      markupPct: next.markupPct,
      riskReservePct: next.riskReservePct,
      discountPct: next.discountPct,
    });
    const result = await apiCall<{ calculation: TenderCalculation }>(
      `/api/tenders/${tenderId}/calculation?${query.toString()}`,
    );
    if (result.ok) setCalculation(result.data.calculation);
  };

  const addItem = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall(`/api/tenders/${tenderId}/boq`, jsonBody(newItem));
    if (!result.ok) {
      setBusy(false);
      setNotice({ tone: "error", text: result.message });
      return;
    }
    const refreshed = await apiCall<{ items: TenderBoqItemRow[] }>(`/api/tenders/${tenderId}/boq`);
    if (refreshed.ok) setBoq(refreshed.data.items);
    setNewItem({ code: "", description: "", unit: "kom", quantity: "1.000", unitCostAmount: "0.00" });
    await recompute();
    setBusy(false);
  };

  const removeItem = async (id: string) => {
    setBusy(true);
    const result = await apiCall(`/api/tenders/${tenderId}/boq/${id}`, { method: "DELETE" });
    if (result.ok) {
      setBoq((rows) => rows.filter((row) => row.id !== id));
      await recompute();
    } else {
      setNotice({ tone: "error", text: result.message });
    }
    setBusy(false);
  };

  const addResource = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall(`/api/tenders/${tenderId}/resources`, jsonBody(newResource));
    if (!result.ok) {
      setBusy(false);
      setNotice({ tone: "error", text: result.message });
      return;
    }
    const refreshed = await apiCall<{ resources: TenderResourceRow[] }>(
      `/api/tenders/${tenderId}/resources`,
    );
    if (refreshed.ok) setResources(refreshed.data.resources);
    setNewResource({ kind: "LABOR", description: "", quantity: "1.000", unit: "h", unitCostAmount: "0.00" });
    await recompute();
    setBusy(false);
  };

  const removeResource = async (id: string) => {
    setBusy(true);
    const result = await apiCall(`/api/tenders/${tenderId}/resources/${id}`, { method: "DELETE" });
    if (result.ok) {
      setResources((rows) => rows.filter((row) => row.id !== id));
      await recompute();
    } else {
      setNotice({ tone: "error", text: result.message });
    }
    setBusy(false);
  };

  const newRevision = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall<{ revision: number; needsApproval: boolean; offeredValueAmount: string }>(
      `/api/tenders/${tenderId}/price-revisions`,
      jsonBody({
        markupPct: params.markupPct,
        riskReservePct: params.riskReservePct,
        discountPct: params.discountPct,
        reason: params.reason.trim() || null,
      }),
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({
      tone: result.data.needsApproval ? "error" : "success",
      text: result.data.needsApproval
        ? `Revizija ${result.data.revision} je upisana, ali traži odobrenje vlasnika/administratora prije slanja ponude.`
        : `Revizija ${result.data.revision} je upisana: ${result.data.offeredValueAmount}.`,
    });
    const refreshed = await apiCall<{ revisions: TenderPriceRevisionRow[] }>(
      `/api/tenders/${tenderId}/price-revisions`,
    );
    if (refreshed.ok) setRevisions(refreshed.data.revisions);
    await recompute();
  };

  const approve = async (revision: number) => {
    setBusy(true);
    const result = await apiCall(`/api/tenders/${tenderId}/price-revisions/${revision}/approve`, {
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({ tone: "success", text: `Revizija ${revision} je odobrena.` });
    const refreshed = await apiCall<{ revisions: TenderPriceRevisionRow[] }>(
      `/api/tenders/${tenderId}/price-revisions`,
    );
    if (refreshed.ok) setRevisions(refreshed.data.revisions);
  };

  return (
    <Stack>
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}

      {calculation ? (
        <div className="gx-card">
          <h3 className="gx-section-title">Obračun ponude</h3>
          <DescriptionList
            items={[
              { term: "Trošak predmjera", value: <Mono>{money(calculation.boqCostAmount, calculation.currencyCode)}</Mono> },
              { term: "Trošak resursa", value: <Mono>{money(calculation.resourcesCostAmount, calculation.currencyCode)}</Mono> },
              { term: "Direktni trošak", value: <Mono>{money(calculation.directCostAmount, calculation.currencyCode)}</Mono> },
              { term: "Baza (trošak + marža + rezerva)", value: <Mono>{money(calculation.baseAmount, calculation.currencyCode)}</Mono> },
              { term: "Ponuđena vrijednost", value: <Mono>{money(calculation.offeredValueAmount, calculation.currencyCode)}</Mono> },
              { term: "Marža (iznos)", value: <Mono>{money(calculation.marginAmount, calculation.currencyCode)}</Mono> },
              {
                term: "Marža (%)",
                value: calculation.marginPct === null ? "—" : <Mono>{calculation.marginPct} %</Mono>,
              },
              { term: "Minimalna marža firme", value: <Mono>{calculation.minMarkupPct} %</Mono> },
            ]}
          />
          {calculation.needsApproval ? (
            <Alert tone="warning" role="status">
              Nova revizija traži odobrenje:{" "}
              {calculation.approvalReasons.map((reason) => APPROVAL_REASON_LABEL[reason]).join(", ")}
              {calculation.changePct ? ` (promjena ${calculation.changePct} %)` : ""}.
            </Alert>
          ) : null}
        </div>
      ) : null}

      <section className="gx-card">
        <h3 className="gx-section-title">Predmjer</h3>
        {boq.length === 0 ? (
          <p className="gx-page-sub">Nema stavki predmjera.</p>
        ) : (
          <DataTable
            caption="Stavke predmjera"
            rowKey={(row) => row.id}
            rows={boq}
            emptyText="Nema stavki."
            columns={[
              { key: "code", header: "Oznaka", cell: (row) => <Mono>{row.code}</Mono> },
              { key: "desc", header: "Opis", cell: (row) => row.description },
              { key: "unit", header: "JM", cell: (row) => row.unit },
              { key: "qty", header: "Količina", numeric: true, cell: (row) => <Mono>{row.quantity}</Mono> },
              { key: "cost", header: "Trošak/JM", numeric: true, cell: (row) => <Mono>{row.unitCostAmount}</Mono> },
              { key: "price", header: "Cijena/JM", numeric: true, cell: (row) => <Mono>{row.unitPriceAmount}</Mono> },
            ]}
            actions={(row) => [
              { key: "del", label: "Obriši stavku", danger: true, onSelect: () => void removeItem(row.id) },
            ]}
          />
        )}
        <div className="gx-cols">
          <Input label="Oznaka" id="boq-code" value={newItem.code}
            onChange={(e) => setNewItem((v) => ({ ...v, code: e.target.value }))} />
          <Input label="Opis" id="boq-desc" value={newItem.description}
            onChange={(e) => setNewItem((v) => ({ ...v, description: e.target.value }))} />
        </div>
        <div className="gx-cols">
          <Input label="Jedinica" id="boq-unit" value={newItem.unit}
            onChange={(e) => setNewItem((v) => ({ ...v, unit: e.target.value }))} />
          <Input label="Količina" id="boq-qty" value={newItem.quantity}
            onChange={(e) => setNewItem((v) => ({ ...v, quantity: e.target.value }))} />
          <Input label="Trošak po jedinici" id="boq-cost" value={newItem.unitCostAmount}
            onChange={(e) => setNewItem((v) => ({ ...v, unitCostAmount: e.target.value }))} />
        </div>
        <Button
          onClick={() => void addItem()}
          disabled={busy || !newItem.code.trim() || !newItem.description.trim()}
        >
          + Dodaj stavku
        </Button>
      </section>

      <section className="gx-card">
        <h3 className="gx-section-title">Resursi</h3>
        {resources.length === 0 ? (
          <p className="gx-page-sub">Nema resursa (rad, mašine, materijal, podizvođači).</p>
        ) : (
          <DataTable
            caption="Resursi kalkulacije"
            rowKey={(row) => row.id}
            rows={resources}
            emptyText="Nema resursa."
            columns={[
              { key: "kind", header: "Vrsta", cell: (row) => RESOURCE_LABEL[row.kind] ?? row.kind },
              { key: "desc", header: "Opis", cell: (row) => row.description },
              { key: "qty", header: "Količina", numeric: true, cell: (row) => <Mono>{row.quantity} {row.unit}</Mono> },
              { key: "cost", header: "Cijena/JM", numeric: true, cell: (row) => <Mono>{row.unitCostAmount}</Mono> },
            ]}
            actions={(row) => [
              { key: "del", label: "Obriši resurs", danger: true, onSelect: () => void removeResource(row.id) },
            ]}
          />
        )}
        <div className="gx-cols">
          <Select label="Vrsta" id="res-kind" value={newResource.kind}
            onChange={(e) => setNewResource((v) => ({ ...v, kind: e.target.value }))}>
            <option value="LABOR">Rad</option>
            <option value="MACHINE">Mašina</option>
            <option value="MATERIAL">Materijal</option>
            <option value="SUBCONTRACTOR">Podizvođač</option>
            <option value="OTHER">Ostalo</option>
          </Select>
          <Input label="Opis" id="res-desc" value={newResource.description}
            onChange={(e) => setNewResource((v) => ({ ...v, description: e.target.value }))} />
        </div>
        <div className="gx-cols">
          <Input label="Količina" id="res-qty" value={newResource.quantity}
            onChange={(e) => setNewResource((v) => ({ ...v, quantity: e.target.value }))} />
          <Input label="Jedinica" id="res-unit" value={newResource.unit}
            onChange={(e) => setNewResource((v) => ({ ...v, unit: e.target.value }))} />
          <Input label="Cijena po jedinici" id="res-cost" value={newResource.unitCostAmount}
            onChange={(e) => setNewResource((v) => ({ ...v, unitCostAmount: e.target.value }))} />
        </div>
        <Button
          onClick={() => void addResource()}
          disabled={busy || !newResource.description.trim()}
        >
          + Dodaj resurs
        </Button>
      </section>

      <section className="gx-card">
        <h3 className="gx-section-title">Nova revizija ponude</h3>
        <p className="gx-page-sub">
          Cijena se mijenja revizijom, nikad prepisivanjem. Odobrena revizija je ono što je poslano.
        </p>
        <div className="gx-cols">
          <Input label="Marža (%)" id="calc-markup" value={params.markupPct}
            onChange={(e) => setParams((p) => ({ ...p, markupPct: e.target.value }))} />
          <Input label="Rezerva za rizik (%)" id="calc-risk" value={params.riskReservePct}
            onChange={(e) => setParams((p) => ({ ...p, riskReservePct: e.target.value }))} />
          <Input label="Popust (%)" id="calc-discount" value={params.discountPct}
            onChange={(e) => setParams((p) => ({ ...p, discountPct: e.target.value }))} />
        </div>
        <Textarea
          label="Razlog revizije (opciono)"
          id="calc-reason"
          value={params.reason}
          onChange={(e) => setParams((p) => ({ ...p, reason: e.target.value }))}
        />
        <Inline>
          <Button onClick={() => void recompute()} disabled={busy}>Preračunaj (bez upisa)</Button>
          <Button variant="primary" onClick={() => void newRevision()} disabled={busy}>
            {busy ? "Čuvam…" : "Upiši novu reviziju"}
          </Button>
        </Inline>
      </section>

      <section className="gx-card">
        <h3 className="gx-section-title">Revizije cijene</h3>
        {revisions.length === 0 ? (
          <p className="gx-page-sub">Nema revizija — ponuda još nije izračunata.</p>
        ) : (
          <DataTable
            caption="Revizije cijene"
            rowKey={(row) => row.id}
            rows={revisions}
            emptyText="Nema revizija."
            columns={[
              { key: "rev", header: "Rev.", numeric: true, cell: (row) => <Mono>#{row.revision}</Mono> },
              { key: "offered", header: "Ponuda", numeric: true,
                cell: (row) => <Mono>{money(row.offeredValueAmount, row.currencyCode)}</Mono> },
              { key: "markup", header: "Marža", numeric: true, cell: (row) => <Mono>{row.markupPct} %</Mono> },
              { key: "discount", header: "Popust", numeric: true, cell: (row) => <Mono>{row.discountPct} %</Mono> },
              {
                key: "approved",
                header: "Odobrenje",
                cell: (row) =>
                  row.approvedAt ? (
                    <Chip tone="full">Odobreno {row.approvedByName ?? ""}</Chip>
                  ) : (
                    <Chip tone="hot">Čeka odobrenje</Chip>
                  ),
              },
            ]}
            actions={(row) =>
              caps.canApprovePrice && !row.approvedAt
                ? [{ key: "appr", label: "Odobri reviziju", onSelect: () => void approve(row.revision) }]
                : []
            }
          />
        )}
      </section>
    </Stack>
  );
}

function money(amount: string, currency: string): string {
  return `${amount} ${currency}`;
}

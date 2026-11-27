"use client";

import { useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Chip, DataTable, Input, Mono, Select, Stack, Textarea,
} from "@/components/ui/index";
import type { TenderChecklistItemRow } from "@gradix/contracts";
import { GUARANTEE_LABEL, formatDate } from "../tenders-shared";

/**
 * Tab „Dokumenti“: kontrolna lista + bankarske garancije (spec 08 §1.4).
 *
 * Jedno pravilo na ekranu: `ATTACHED` bez priloga i `NOT_APPLICABLE` bez razloga ne prolaze —
 * dugme „Sačuvaj“ je zaključano dok unos nije potpun, a server to i sam provjerava. Garancija
 * bez roka važenja ne postoji: polje je obavezno.
 */
export function TenderDocumentsTab({
  tenderId,
  initialItems,
  initialBlocking,
  attachments,
  caps,
}: {
  tenderId: string;
  initialItems: TenderChecklistItemRow[];
  initialBlocking: string[];
  attachments: Array<{ id: string; fileName: string; status: string }>;
  caps: { canManage: boolean };
}) {
  const [items, setItems] = useState(initialItems);
  const [blocking, setBlocking] = useState(initialBlocking);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    status: "MISSING" as TenderChecklistItemRow["status"],
    attachmentId: "",
    note: "",
    validUntil: "",
  });
  const [guarantee, setGuarantee] = useState({
    code: "", label: "", guaranteeType: "BID", bank: "", amount: "", validUntil: "", note: "",
  });
  const [addingGuarantee, setAddingGuarantee] = useState(false);

  const reload = async () => {
    const refreshed = await apiCall<{ items: TenderChecklistItemRow[]; blocking: string[] }>(
      `/api/tenders/${tenderId}/checklist`,
    );
    if (refreshed.ok) {
      setItems(refreshed.data.items);
      setBlocking(refreshed.data.blocking);
    }
  };

  const startEdit = (item: TenderChecklistItemRow) => {
    setEditing(item.id);
    setDraft({
      status: item.status,
      attachmentId: item.attachmentId ?? "",
      note: item.note ?? "",
      validUntil: item.validUntil ?? "",
    });
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setNotice(null);
    const result = await apiCall(`/api/tenders/${tenderId}/checklist/${editing}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: draft.status,
        attachmentId: draft.status === "ATTACHED" ? draft.attachmentId : null,
        note: draft.note.trim() || null,
        validUntil: draft.validUntil || null,
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setEditing(null);
    setNotice({ tone: "success", text: "Stavka je sačuvana." });
    await reload();
  };

  const addGuarantee = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall(`/api/tenders/${tenderId}/guarantees`, jsonBody({
      code: guarantee.code.trim(),
      label: guarantee.label.trim(),
      guaranteeType: guarantee.guaranteeType,
      bank: guarantee.bank.trim() || null,
      amount: guarantee.amount.trim() || null,
      validUntil: guarantee.validUntil,
      note: guarantee.note.trim() || null,
    }));
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setAddingGuarantee(false);
    setGuarantee({ code: "", label: "", guaranteeType: "BID", bank: "", amount: "", validUntil: "", note: "" });
    setNotice({ tone: "success", text: "Garancija je dodana." });
    await reload();
  };

  const markReturned = async (id: string) => {
    setBusy(true);
    const result = await apiCall(`/api/tenders/${tenderId}/guarantees/${id}/return`, { method: "POST" });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({ tone: "success", text: "Povrat garancije je evidentiran." });
    await reload();
  };

  const readyAttachments = attachments.filter((att) => att.status === "ready");
  const documentItems = items.filter((item) => !item.guaranteeType);
  const guarantees = items.filter((item) => item.guaranteeType);

  return (
    <Stack>
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}
      {blocking.length > 0 ? (
        <Alert tone="warning" role="status">
          Predaja je blokirana dok ove stavke nijesu priložene ili označene „nije primjenjivo“:{" "}
          <strong>{blocking.join(", ")}</strong>.
        </Alert>
      ) : (
        <Alert tone="success" role="status">Kontrolna lista je kompletna — predaja je moguća.</Alert>
      )}

      <section className="gx-card">
        <h3 className="gx-section-title">Kontrolna lista dokumenata</h3>
        <DataTable
          caption="Kontrolna lista"
          rowKey={(row) => row.id}
          rows={documentItems}
          emptyText="Nema stavki kontrolne liste."
          columns={[
            { key: "label", header: "Dokument", cell: (row) => row.label },
            {
              key: "req",
              header: "Obavezno",
              cell: (row) => (row.required ? "Da" : "Ne"),
            },
            {
              key: "status",
              header: "Stanje",
              cell: (row) => (
                <Chip tone={row.status === "ATTACHED" ? "full" : row.status === "MISSING" ? "hot" : "hollow"}>
                  {row.status === "ATTACHED" ? "Priloženo" : row.status === "MISSING" ? "Nedostaje" : "Nije primjenjivo"}
                </Chip>
              ),
            },
            { key: "note", header: "Napomena", cell: (row) => row.note ?? "—" },
          ]}
          actions={(row) =>
            caps.canManage
              ? [{ key: "edit", label: "Uredi stavku", onSelect: () => startEdit(row) }]
              : []
          }
        />
        {editing ? (
          <div className="gx-card">
            <h4 className="gx-section-title">Uredi stavku</h4>
            <Stack>
              <Select
                label="Stanje"
                id="chk-status"
                value={draft.status}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, status: e.target.value as TenderChecklistItemRow["status"] }))
                }
              >
                <option value="MISSING">Nedostaje</option>
                <option value="ATTACHED">Priloženo</option>
                <option value="NOT_APPLICABLE">Nije primjenjivo</option>
              </Select>
              {draft.status === "ATTACHED" ? (
                <Select
                  label="Prilog"
                  id="chk-attachment"
                  value={draft.attachmentId}
                  onChange={(e) => setDraft((d) => ({ ...d, attachmentId: e.target.value }))}
                  required
                >
                  <option value="">— izaberite prilog —</option>
                  {readyAttachments.map((att) => (
                    <option key={att.id} value={att.id}>{att.fileName}</option>
                  ))}
                </Select>
              ) : null}
              {draft.status === "MISSING" ? null : (
                <Textarea
                  label={draft.status === "NOT_APPLICABLE" ? "Razlog (obavezan)" : "Napomena"}
                  id="chk-note"
                  value={draft.note}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                />
              )}
              <div className="gx-dialog__actions">
                <Button variant="quiet" onClick={() => setEditing(null)} disabled={busy}>Otkaži</Button>
                <Button
                  variant="primary"
                  onClick={() => void save()}
                  disabled={
                    busy ||
                    (draft.status === "ATTACHED" && !draft.attachmentId) ||
                    (draft.status === "NOT_APPLICABLE" && draft.note.trim().length < 3)
                  }
                >
                  {busy ? "Čuvam…" : "Sačuvaj"}
                </Button>
              </div>
            </Stack>
          </div>
        ) : null}
      </section>

      <section className="gx-card">
        <h3 className="gx-section-title">Bankarske garancije</h3>
        <p className="gx-page-sub">
          Garancija uvijek ima rok važenja; podsjetnik ide 30 dana prije isteka, a povrat se evidentira.
        </p>
        {guarantees.length === 0 ? (
          <p className="gx-page-sub">Nema garancija na ovom tenderu.</p>
        ) : (
          <DataTable
            caption="Garancije"
            rowKey={(row) => row.id}
            rows={guarantees}
            emptyText="Nema garancija."
            columns={[
              { key: "label", header: "Garancija", cell: (row) => row.label },
              {
                key: "type",
                header: "Vrsta",
                cell: (row) => (row.guaranteeType ? GUARANTEE_LABEL[row.guaranteeType] : "—"),
              },
              { key: "bank", header: "Banka", cell: (row) => row.bank ?? "—" },
              {
                key: "amount",
                header: "Iznos",
                numeric: true,
                cell: (row) => (row.amount ? <Mono>{row.amount}</Mono> : "—"),
              },
              { key: "valid", header: "Važi do", cell: (row) => formatDate(row.validUntil) },
              {
                key: "returned",
                header: "Povrat",
                cell: (row) =>
                  row.returnedAt ? (
                    <Chip tone="full">Vraćena {formatDate(row.returnedAt)}</Chip>
                  ) : (
                    <Chip tone="hollow">Kod banke</Chip>
                  ),
              },
            ]}
            actions={(row) =>
              caps.canManage && !row.returnedAt
                ? [{ key: "ret", label: "Evidentiraj povrat", onSelect: () => void markReturned(row.id) }]
                : []
            }
          />
        )}
        {caps.canManage && addingGuarantee ? (
          <Stack>
            <div className="gx-cols">
              <Input label="Oznaka" id="gur-code" value={guarantee.code}
                onChange={(e) => setGuarantee((g) => ({ ...g, code: e.target.value }))} />
              <Input label="Naziv" id="gur-label" value={guarantee.label}
                onChange={(e) => setGuarantee((g) => ({ ...g, label: e.target.value }))} />
            </div>
            <div className="gx-cols">
              <Select label="Vrsta" id="gur-type" value={guarantee.guaranteeType}
                onChange={(e) => setGuarantee((g) => ({ ...g, guaranteeType: e.target.value }))}>
                <option value="BID">Ponudbena</option>
                <option value="PERFORMANCE">Za dobro izvršenje</option>
                <option value="ADVANCE">Avansna</option>
                <option value="WARRANTY">Za otklanjanje nedostataka</option>
              </Select>
              <Input label="Banka" id="gur-bank" value={guarantee.bank}
                onChange={(e) => setGuarantee((g) => ({ ...g, bank: e.target.value }))} />
            </div>
            <div className="gx-cols">
              <Input label="Iznos" id="gur-amount" value={guarantee.amount}
                onChange={(e) => setGuarantee((g) => ({ ...g, amount: e.target.value }))} />
              <Input label="Važi do" id="gur-valid" type="date" value={guarantee.validUntil}
                onChange={(e) => setGuarantee((g) => ({ ...g, validUntil: e.target.value }))} required />
            </div>
            <div className="gx-dialog__actions">
              <Button variant="quiet" onClick={() => setAddingGuarantee(false)} disabled={busy}>Otkaži</Button>
              <Button
                variant="primary"
                onClick={() => void addGuarantee()}
                disabled={busy || !guarantee.code.trim() || !guarantee.label.trim() || !guarantee.validUntil}
              >
                {busy ? "Čuvam…" : "Dodaj garanciju"}
              </Button>
            </div>
          </Stack>
        ) : caps.canManage ? (
          <Button onClick={() => setAddingGuarantee(true)}>+ Dodaj garanciju</Button>
        ) : null}
      </section>
    </Stack>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Chip, DataTable, Dialog, FilterBar, Input, Mono, Select, Stack,
} from "@/components/ui/index";
import type { PartnerRow } from "@/server/machine-fault-types";

const KIND_LABEL: Record<PartnerRow["kind"], string> = {
  CLIENT: "Naručilac",
  VENDOR: "Dobavljač",
  SERVICE: "Servis",
  OTHER: "Ostalo",
};

export function PartnersClient({
  initialPartners,
  canManage,
}: {
  initialPartners: PartnerRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [kindFilter, setKindFilter] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dialog, setDialog] = useState<"create" | { edit: PartnerRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", kind: "CLIENT" as PartnerRow["kind"], note: "" });

  const visible = useMemo(
    () => initialPartners.filter((row) => !kindFilter || row.kind === kindFilter),
    [initialPartners, kindFilter],
  );

  const openCreate = () => {
    setForm({ code: "", name: "", kind: "CLIENT", note: "" });
    setDialog("create");
  };

  const openEdit = (row: PartnerRow) => {
    setForm({ code: row.code, name: row.name, kind: row.kind, note: row.note ?? "" });
    setDialog({ edit: row });
  };

  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      if (dialog === "create") {
        const result = await apiCall("/api/partners", jsonBody({
          code: form.code.trim(), name: form.name.trim(), kind: form.kind,
          note: form.note.trim() || null,
        }));
        if (!result.ok) { setNotice({ tone: "error", text: result.message }); return; }
        setNotice({ tone: "success", text: "Partner je dodan." });
      } else if (dialog && "edit" in dialog) {
        const result = await apiCall(`/api/partners/${dialog.edit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(), kind: form.kind, note: form.note.trim() || null,
          }),
        });
        if (!result.ok) { setNotice({ tone: "error", text: result.message }); return; }
        setNotice({ tone: "success", text: "Partner je ažuriran." });
      }
      setDialog(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (row: PartnerRow) => {
    setBusy(true);
    const result = await apiCall(`/api/partners/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    setBusy(false);
    if (!result.ok) { setNotice({ tone: "error", text: result.message }); return; }
    setNotice({ tone: "success", text: "Partner je deaktiviran." });
    router.refresh();
  };

  return (
    <Stack>
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}
      <FilterBar>
        <Select label="Vrsta" id="ptr-kind" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
          <option value="">Sve</option>
          {(Object.keys(KIND_LABEL) as PartnerRow["kind"][]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </Select>
        {canManage ? (
          <Button variant="primary" onClick={openCreate}>+ Novi partner</Button>
        ) : null}
      </FilterBar>
      <DataTable
        caption="Partneri"
        rowKey={(row) => row.id}
        rows={visible}
        emptyText="Nema partnera."
        columns={[
          { key: "code", header: "Šifra", cell: (row) => <Mono>{row.code}</Mono> },
          { key: "name", header: "Naziv", cell: (row) => row.name },
          { key: "kind", header: "Vrsta", cell: (row) => KIND_LABEL[row.kind] },
          {
            key: "st",
            header: "Status",
            cell: (row) => (
              <Chip tone={row.active ? "full" : "hollow"}>{row.active ? "Aktivan" : "Neaktivan"}</Chip>
            ),
          },
        ]}
        actions={canManage ? (row) => [
          { key: "edit", label: "Izmijeni", onSelect: () => openEdit(row) },
          ...(row.active
            ? [{ key: "off", label: "Deaktiviraj", danger: true as const, onSelect: () => void deactivate(row) }]
            : []),
        ] : undefined}
      />
      {dialog ? (
        <Dialog
          title={dialog === "create" ? "Novi partner" : "Izmijeni partnera"}
          onClose={() => setDialog(null)}
        >
          <Stack>
            {dialog === "create" ? (
              <Input label="Šifra" id="ptr-code" value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} required />
            ) : null}
            <Input label="Naziv" id="ptr-name" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            <Select label="Vrsta" id="ptr-form-kind" value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as PartnerRow["kind"] }))}>
              {(Object.keys(KIND_LABEL) as PartnerRow["kind"][]).map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </Select>
            <Input label="Napomena" id="ptr-note" value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            <div className="gx-dialog__actions">
              <Button variant="quiet" onClick={() => setDialog(null)} disabled={busy}>Otkaži</Button>
              <Button variant="primary" onClick={() => void save()} disabled={busy || !form.name.trim()}>
                {busy ? "Čuvam…" : "Sačuvaj"}
              </Button>
            </div>
          </Stack>
        </Dialog>
      ) : null}
    </Stack>
  );
}

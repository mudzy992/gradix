"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Chip, DataTable, Dialog, FilterBar, Input, Mono, Select, Stack,
} from "@/components/ui/index";
import type { TenderRow, TenderStatus } from "@gradix/contracts";
import { formatTenderValue, STATUS_LABEL, STATUS_OPTIONS } from "./tenders-shared";

type Caps = { canManage: boolean; canConvert: boolean };
type PartnerOpt = { id: string; code: string; name: string; kind: string };

export function TendersClient({
  initialTenders,
  caps,
}: {
  initialTenders: TenderRow[];
  caps: Caps;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [partners, setPartners] = useState<PartnerOpt[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "", partnerId: "", submittedValueAmount: "", currencyCode: "BAM", note: "",
  });

  const visible = useMemo(
    () => initialTenders.filter((row) => !statusFilter || row.status === statusFilter),
    [initialTenders, statusFilter],
  );

  const openCreate = async () => {
    if (!partners) {
      const res = await apiCall<{ partners: PartnerOpt[] }>("/api/partners");
      if (res.ok) {
        const list = res.data.partners;
        setPartners([
          ...list.filter((p) => p.kind === "CLIENT"),
          ...list.filter((p) => p.kind !== "CLIENT"),
        ]);
      }
    }
    setForm({ title: "", partnerId: "", submittedValueAmount: "", currencyCode: "BAM", note: "" });
    setCreating(true);
  };

  const save = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall("/api/tenders", jsonBody({
      title: form.title.trim(),
      partnerId: form.partnerId,
      submittedValueAmount: form.submittedValueAmount.trim(),
      currencyCode: form.currencyCode,
      note: form.note.trim() || null,
    }));
    setBusy(false);
    if (!result.ok) { setNotice({ tone: "error", text: result.message }); return; }
    setCreating(false);
    setNotice({ tone: "success", text: "Tender je kreiran." });
    router.refresh();
  };

  const convert = async (row: TenderRow) => {
    setBusy(true);
    const result = await apiCall<{ outcome: string; projectId?: string }>(
      `/api/tenders/${row.id}/convert`,
      { method: "POST" },
    );
    setBusy(false);
    if (!result.ok) { setNotice({ tone: "error", text: result.message }); return; }
    setNotice({ tone: "success", text: "Tender je pretvoren u projekat." });
    router.refresh();
  };

  return (
    <Stack>
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}
      <FilterBar>
        <Select label="Status" id="tnd-st" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Svi</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </Select>
        {caps.canManage ? (
          <Button variant="primary" onClick={() => void openCreate()}>+ Novi tender</Button>
        ) : null}
      </FilterBar>
      <DataTable
        caption="Tenderi"
        rowKey={(row) => row.id}
        rows={visible}
        emptyText="Nema tendera."
        columns={[
          { key: "title", header: "Predmet", cell: (row) => row.title },
          { key: "client", header: "Naručilac", cell: (row) => row.partnerName },
          {
            key: "value",
            header: "Vrijednost",
            numeric: true,
            cell: (row) => (
              <Mono>{formatTenderValue(row.submittedValueAmount, row.currencyCode)}</Mono>
            ),
          },
          {
            key: "st",
            header: "Status",
            cell: (row) => (
              <Chip tone={row.status === "WON" ? "full" : "hollow"}>
                {STATUS_LABEL[row.status as TenderStatus]}
              </Chip>
            ),
          },
        ]}
        actions={(row) => [
          { key: "open", label: "Otvori", onSelect: () => router.push(`/ured/tenderi/${row.id}`) },
          ...(caps.canConvert && row.status === "WON" && !row.convertedProjectId
            ? [{ key: "conv", label: "Pretvori u projekat", onSelect: () => void convert(row) }]
            : []),
        ]}
      />
      {creating ? (
        <Dialog title="Novi tender" onClose={() => setCreating(false)}>
          <Stack>
            <Input label="Predmet" id="tnd-title" value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
            <Select label="Naručilac" id="tnd-partner" value={form.partnerId}
              onChange={(e) => setForm((f) => ({ ...f, partnerId: e.target.value }))} required>
              <option value="">— izaberite —</option>
              {(partners ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
              ))}
            </Select>
            <div className="gx-cols">
              <Input label="Iznos" id="tnd-amount" value={form.submittedValueAmount}
                onChange={(e) => setForm((f) => ({ ...f, submittedValueAmount: e.target.value }))} required />
              <Select label="Valuta" id="tnd-cur" value={form.currencyCode}
                onChange={(e) => setForm((f) => ({ ...f, currencyCode: e.target.value }))}>
                <option value="BAM">BAM</option>
                <option value="EUR">EUR</option>
              </Select>
            </div>
            <Input label="Napomena" id="tnd-note" value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            <div className="gx-dialog__actions">
              <Button variant="quiet" onClick={() => setCreating(false)} disabled={busy}>Otkaži</Button>
              <Button variant="primary" onClick={() => void save()}
                disabled={busy || !form.title.trim() || !form.partnerId || !form.submittedValueAmount.trim()}>
                {busy ? "Čuvam…" : "Sačuvaj"}
              </Button>
            </div>
          </Stack>
        </Dialog>
      ) : null}
    </Stack>
  );
}

"use client";

/**
 * Aneksi (tab 5) — samo `APPROVED` mijenja vrijednost ugovora i rok.
 *
 * Zašto se nacrt i odobreni aneks vide u istoj tabeli: aneks je jedan dokument sa stanjem. Odvajanje
 * bi značilo da se „šta je stvarno na snazi“ traži na dva mjesta, a to je upravo pitanje zbog kojeg
 * se u projekat i ulazi.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import { formatDate } from "@/format";
import {
  Alert, Button, Chip, DataTable, Dialog, EmptyState, Input, Select, Skeleton, Stat, Textarea,
} from "@/components/ui/index";
import type { AmendmentRow, AmendmentsResult } from "@/server/project-finance-types";

const KIND_LABEL: Record<AmendmentRow["kind"], string> = {
  SCOPE: "Obim",
  TIME: "Rok",
  PRICE: "Cijena",
  OTHER: "Ostalo",
};

const STATUS_LABEL: Record<AmendmentRow["status"], string> = {
  DRAFT: "Nacrt",
  SUBMITTED: "Poslan",
  APPROVED: "Odobren",
  REJECTED: "Odbijen",
};

type AmendmentForm = {
  id?: string;
  code: string;
  title: string;
  kind: AmendmentRow["kind"];
  amount: string;
  extensionDays: string;
  note: string;
};

const EMPTY: AmendmentForm = { code: "", title: "", kind: "PRICE", amount: "", extensionDays: "", note: "" };

export function ProjectAmendments({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [data, setData] = useState<AmendmentsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AmendmentForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const result = await apiCall<AmendmentsResult>(`/api/projects/${projectId}/amendments`);
    if (!result.ok) {
      setError(result.message);
      setData(null);
      return;
    }
    setData(result.data);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    const result = await apiCall<AmendmentsResult>(`/api/projects/${projectId}/amendments`, {
      ...jsonBody({
        ...(form.id ? { id: form.id } : {}),
        code: form.code.trim(),
        title: form.title.trim(),
        kind: form.kind,
        amount: form.amount.trim() || null,
        extensionDays: form.extensionDays === "" ? null : Number(form.extensionDays),
        note: form.note.trim() || null,
      }),
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setForm(null);
    setMessage("Aneks je sačuvan kao nacrt. Vrijednost ugovora se mijenja tek kad bude odobren.");
    await load();
  }

  async function decide(amendment: AmendmentRow, action: "SUBMIT" | "APPROVE" | "REJECT") {
    setBusy(true);
    setError(null);
    const result = await apiCall<AmendmentsResult>(
      `/api/projects/${projectId}/amendments/${amendment.id}`,
      patchBody({ action, reason: null }),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage(
      action === "APPROVE"
        ? "Aneks je odobren — vrijednost ugovora i rok su ažurirani."
        : action === "REJECT"
          ? "Aneks je odbijen; vrijednost ugovora ostaje nepromijenjena."
          : "Aneks je poslan na odluku.",
    );
    await load();
  }

  if (error && data === null) return <Alert tone="error">{error}</Alert>;
  if (data === null) return <Skeleton rows={4} />;

  return (
    <div className="gx-stack">
      {message ? <Alert tone="success" role="status">{message}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="gx-cols">
        <Stat label="Odobreni aneksi (novac)" value={data.approved_amount} hint={`Valuta: ${data.currency_code}`} />
        <Stat label="Odobreno produženje" value={`${data.approved_extension_days} dana`} />
      </div>

      {canManage ? (
        <div className="gx-inline-flex">
          <Button variant="primary" onClick={() => setForm({ ...EMPTY })}>
            + Novi aneks
          </Button>
        </div>
      ) : null}

      {data.amendments.length === 0 ? (
        <EmptyState
          title="Nema aneksa"
          description="Aneks mijenja obim, rok ili cijenu. Samo odobren aneks ulazi u vrijednost ugovora i u maržu."
        />
      ) : (
        <DataTable
          caption="Aneksi ugovora"
          rows={data.amendments}
          rowKey={(amendment) => amendment.id}
          emptyText="Nema aneksa."
          columns={[
            {
              key: "code",
              header: "Aneks",
              cell: (amendment) => (
                <span className="gx-stack gx-stack--2">
                  <span>{amendment.title}</span>
                  <span className="gx-page-sub">
                    {amendment.code} · {KIND_LABEL[amendment.kind]}
                  </span>
                </span>
              ),
            },
            {
              key: "amount",
              header: "Iznos",
              numeric: true,
              cell: (amendment) => amendment.amount ?? "—",
            },
            {
              key: "days",
              header: "Produženje",
              numeric: true,
              cell: (amendment) => (amendment.extension_days === null ? "—" : `${amendment.extension_days} dana`),
            },
            {
              key: "status",
              header: "Stanje",
              cell: (amendment) => (
                <span className="gx-stack gx-stack--2">
                  <Chip tone={amendment.status === "APPROVED" ? "hollow" : amendment.status === "REJECTED" ? "hot" : "hollow"}>
                    {STATUS_LABEL[amendment.status]}
                  </Chip>
                  {amendment.approved_at ? (
                    <span className="gx-page-sub">
                      {formatDate(amendment.approved_at)}
                      {amendment.approved_by_name ? ` · ${amendment.approved_by_name}` : ""}
                    </span>
                  ) : null}
                </span>
              ),
            },
          ]}
          rowActionLabel={(amendment) => `Više radnji za aneks ${amendment.code}`}
          actions={(amendment) => {
            if (!canManage) return [];
            const actions = [];
            if (amendment.status === "DRAFT") {
              actions.push({ key: "submit", label: "Pošalji na odluku", onSelect: () => void decide(amendment, "SUBMIT") });
            }
            if (amendment.status === "SUBMITTED") {
              actions.push({ key: "approve", label: "Odobri", onSelect: () => void decide(amendment, "APPROVE") });
              actions.push({
                key: "reject",
                label: "Odbij",
                danger: true,
                onSelect: () => void decide(amendment, "REJECT"),
              });
            }
            if (amendment.status === "DRAFT" || amendment.status === "REJECTED") {
              actions.push({
                key: "edit",
                label: "Izmijeni nacrt",
                onSelect: () =>
                  setForm({
                    id: amendment.id,
                    code: amendment.code,
                    title: amendment.title,
                    kind: amendment.kind,
                    amount: amendment.amount ?? "",
                    extensionDays: amendment.extension_days === null ? "" : String(amendment.extension_days),
                    note: amendment.note ?? "",
                  }),
              });
            }
            return actions;
          }}
        />
      )}

      {form ? (
        <Dialog
          title={form.id ? "Izmjena aneksa" : "Novi aneks"}
          hint="Nacrt ne dira ugovor. Odobrenje mijenja vrijednost (i rok) i ulazi u maržu."
          returnFocusTo={null}
          onClose={() => setForm(null)}
        >
          <form className="gx-stack" onSubmit={submit}>
            <Input
              label="Šifra"
              required
              maxLength={30}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
            <Input
              label="Naslov"
              required
              maxLength={200}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
            <Select
              label="Vrsta"
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value as AmendmentForm["kind"] })}
            >
              <option value="PRICE">Cijena</option>
              <option value="SCOPE">Obim</option>
              <option value="TIME">Rok</option>
              <option value="OTHER">Ostalo</option>
            </Select>
            <Input
              label="Iznos (opciono)"
              inputMode="decimal"
              hint="Dvije decimale. Rok bez novca ostavlja polje praznim."
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
            />
            <Input
              label="Produženje roka (dana)"
              type="number"
              min={0}
              max={3650}
              value={form.extensionDays}
              onChange={(event) => setForm({ ...form, extensionDays: event.target.value })}
            />
            <Textarea
              label="Napomena"
              rows={2}
              maxLength={2000}
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
            <div className="gx-inline-flex gx-mt-2">
              <Button variant="quiet" onClick={() => setForm(null)}>
                Otkaži
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                Sačuvaj aneks
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

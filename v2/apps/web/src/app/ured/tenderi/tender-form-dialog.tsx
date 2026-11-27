"use client";

import { Button, Dialog, Input, Select, Stack } from "@/components/ui/index";
import type { TenderRow } from "@gradix/contracts";

export type TenderFormState = {
  title: string;
  partnerId: string;
  submittedValueAmount: string;
  currencyCode: string;
  estimatedValueAmount: string;
  externalRef: string;
  source: string;
  portalName: string;
  deadlineAt: string;
  questionsDeadlineAt: string;
  siteVisitAt: string;
  note: string;
};

export const EMPTY_TENDER_FORM: TenderFormState = {
  title: "",
  partnerId: "",
  submittedValueAmount: "0.00",
  currencyCode: "BAM",
  estimatedValueAmount: "",
  externalRef: "",
  source: "",
  portalName: "",
  deadlineAt: "",
  questionsDeadlineAt: "",
  siteVisitAt: "",
  note: "",
};

/**
 * Dijalog „Novi tender“ (spec 08 §1.2).
 *
 * Izdvojen iz `tenders-client.tsx` jer lista ima svoj posao (filteri, tabela, kanban) — a
 * dvanaest polja unosa bi je preguralo preko granice čitljivosti. Forma ne šalje sama: vraća
 * stanje kroz `onSave`, da jedan `save` u listi drži i kopiranje predmjera.
 */
export function TenderFormDialog({
  form,
  onChange,
  onClose,
  onSave,
  partners,
  copyFrom,
  onCopyFromChange,
  tenders,
  busy,
}: {
  form: TenderFormState;
  onChange: (next: TenderFormState) => void;
  onClose: () => void;
  onSave: () => void;
  partners: Array<{ id: string; code: string; name: string }> | null;
  copyFrom: string;
  onCopyFromChange: (value: string) => void;
  tenders: TenderRow[];
  busy: boolean;
}) {
  const set = <K extends keyof TenderFormState>(key: K, value: TenderFormState[K]) =>
    onChange({ ...form, [key]: value });

  const canSave =
    form.title.trim().length > 0 &&
    form.partnerId.length > 0 &&
    /^\d+(\.\d{1,2})?$/.test(form.submittedValueAmount.trim() || "0");

  return (
    <Dialog title="Novi tender" onClose={onClose}>
      <Stack>
        <Input
          label="Predmet"
          id="tnd-title"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          required
        />
        <Select
          label="Naručilac"
          id="tnd-partner"
          value={form.partnerId}
          onChange={(e) => set("partnerId", e.target.value)}
          required
        >
          <option value="">— izaberite —</option>
          {(partners ?? []).map((partner) => (
            <option key={partner.id} value={partner.id}>{partner.code} · {partner.name}</option>
          ))}
        </Select>
        <div className="gx-cols">
          <Input
            label="Rok dostave"
            id="tnd-deadline"
            type="datetime-local"
            value={form.deadlineAt}
            onChange={(e) => set("deadlineAt", e.target.value)}
          />
          <Input
            label="Rok za pitanja"
            id="tnd-questions"
            type="datetime-local"
            value={form.questionsDeadlineAt}
            onChange={(e) => set("questionsDeadlineAt", e.target.value)}
          />
        </div>
        <div className="gx-cols">
          <Input
            label="Obilazak lokacije"
            id="tnd-visit"
            type="datetime-local"
            value={form.siteVisitAt}
            onChange={(e) => set("siteVisitAt", e.target.value)}
          />
          <Select
            label="Izvor"
            id="tnd-source"
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
          >
            <option value="">— nepoznato —</option>
            <option value="PORTAL">Portal</option>
            <option value="INVITATION">Poziv naručioca</option>
            <option value="DIRECT">Direktno</option>
            <option value="OTHER">Ostalo</option>
          </Select>
        </div>
        <div className="gx-cols">
          <Input
            label="Portal"
            id="tnd-portal"
            value={form.portalName}
            onChange={(e) => set("portalName", e.target.value)}
          />
          <Input
            label="Referentni broj naručioca"
            id="tnd-ref"
            value={form.externalRef}
            onChange={(e) => set("externalRef", e.target.value)}
          />
        </div>
        <div className="gx-cols">
          <Input
            label="Procjena naručioca"
            id="tnd-estimated"
            value={form.estimatedValueAmount}
            onChange={(e) => set("estimatedValueAmount", e.target.value)}
            hint="Odvojeno od naše ponude."
          />
          <Select
            label="Valuta"
            id="tnd-cur"
            value={form.currencyCode}
            onChange={(e) => set("currencyCode", e.target.value)}
          >
            <option value="BAM">BAM</option>
            <option value="EUR">EUR</option>
          </Select>
        </div>
        <Select
          label="Kopiraj predmjer iz sličnog tendera"
          id="tnd-copy"
          value={copyFrom}
          onChange={(e) => onCopyFromChange(e.target.value)}
        >
          <option value="">— ne kopiram —</option>
          {tenders.map((row) => (
            <option key={row.id} value={row.id}>{row.title} · {row.partnerName}</option>
          ))}
        </Select>
        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={busy}>Otkaži</Button>
          <Button variant="primary" onClick={onSave} disabled={busy || !canSave}>
            {busy ? "Čuvam…" : "Sačuvaj tender"}
          </Button>
        </div>
      </Stack>
    </Dialog>
  );
}

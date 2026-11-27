"use client";

import { useState } from "react";
import { apiCall } from "@/api-client";
import {
  Alert, Button, DescriptionList, Input, Mono, Select, Stack, Textarea,
} from "@/components/ui/index";
import type { TenderOutcomeRow } from "@gradix/contracts";
import type { TenderRow } from "@gradix/contracts";
import { LOST_REASON_LABEL, STATUS_LABEL } from "../tenders-shared";

/**
 * Tab „Ishod“: rezultat, razlog gubitka, pobjednik, rang, broj ponuda (spec 08 §1.5).
 *
 * Razlog je obavezan za sve osim `WON` (§1.5/20). Polja pobjednika i ranga nisu obavezna, ali
 * su ponuđena jer bez njih analiza gubitka ne kaže ništa korisno.
 */
export function TenderOutcomeTab({
  tender,
  initialOutcome,
  partners,
  caps,
  onChanged,
}: {
  tender: TenderRow;
  initialOutcome: TenderOutcomeRow | null;
  partners: Array<{ id: string; code: string; name: string }>;
  caps: { canOutcome: boolean; canManage: boolean };
  onChanged: () => void;
}) {
  const [outcome, setOutcome] = useState(initialOutcome);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    result: (["WON", "LOST", "WITHDRAWN", "CANCELLED"].includes(tender.status)
      ? tender.status
      : "LOST") as "WON" | "LOST" | "WITHDRAWN" | "CANCELLED",
    lostReason: "",
    winnerPartnerId: "",
    winnerValueAmount: "",
    biddersCount: "",
    ourRank: "",
    note: "",
  });

  const save = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall(`/api/tenders/${tender.id}/outcome`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        result: form.result,
        lostReason: form.result === "WON" ? null : form.lostReason || null,
        winnerPartnerId: form.winnerPartnerId || null,
        winnerValueAmount: form.winnerValueAmount.trim() || null,
        biddersCount: form.biddersCount ? Number(form.biddersCount) : null,
        ourRank: form.ourRank ? Number(form.ourRank) : null,
        note: form.note.trim() || null,
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    const refreshed = await apiCall<{ outcome: TenderOutcomeRow | null }>(
      `/api/tenders/${tender.id}/outcome`,
    );
    if (refreshed.ok) setOutcome(refreshed.data.outcome);
    setShowForm(false);
    setNotice({ tone: "success", text: "Ishod je zapisan." });
    onChanged();
  };

  const canSave = form.result === "WON" || form.lostReason.length > 0;

  return (
    <Stack>
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}

      {outcome ? (
        <div className="gx-card">
          <h3 className="gx-section-title">Zapisan ishod</h3>
          <DescriptionList
            items={[
              { term: "Rezultat", value: STATUS_LABEL[outcome.result] },
              {
                term: "Razlog",
                value: outcome.lostReason ? LOST_REASON_LABEL[outcome.lostReason] ?? outcome.lostReason : "—",
              },
              { term: "Pobjednik", value: outcome.winnerPartnerName ?? "—" },
              {
                term: "Pobjednička cijena",
                value: outcome.winnerValueAmount ? <Mono>{outcome.winnerValueAmount}</Mono> : "—",
              },
              { term: "Broj ponuda", value: outcome.biddersCount ?? "—" },
              { term: "Naš rang", value: outcome.ourRank ?? "—" },
              { term: "Napomena", value: outcome.note ?? "—" },
            ]}
          />
        </div>
      ) : (
        <p className="gx-page-sub">
          Ishod još nije zapisan. Zatvaranje tendera (Dobijeno, Izgubljeno, Povučeno, Otkazano)
          traži ishod sa razlogom.
        </p>
      )}

      {caps.canOutcome && !outcome ? (
        showForm ? (
          <div className="gx-card">
            <h3 className="gx-section-title">Upis ishoda</h3>
            <Stack>
              <Select
                label="Rezultat"
                id="out-result"
                value={form.result}
                onChange={(e) =>
                  setForm((f) => ({ ...f, result: e.target.value as typeof f.result }))
                }
              >
                <option value="WON">Dobijeno</option>
                <option value="LOST">Izgubljeno</option>
                <option value="WITHDRAWN">Povučeno</option>
                <option value="CANCELLED">Otkazano</option>
              </Select>
              {form.result !== "WON" ? (
                <Select
                  label="Razlog (obavezan)"
                  id="out-reason"
                  value={form.lostReason}
                  onChange={(e) => setForm((f) => ({ ...f, lostReason: e.target.value }))}
                  required
                >
                  <option value="">— izaberite razlog —</option>
                  <option value="PRICE">Cijena</option>
                  <option value="TECHNICAL">Tehnička ponuda</option>
                  <option value="DOCUMENTATION">Dokumentacija</option>
                  <option value="RELATIONSHIP">Odnos sa naručiocem</option>
                  <option value="SCOPE">Obim posla</option>
                  <option value="OTHER">Ostalo</option>
                </Select>
              ) : null}
              <Select
                label="Pobjednik (opciono)"
                id="out-winner"
                value={form.winnerPartnerId}
                onChange={(e) => setForm((f) => ({ ...f, winnerPartnerId: e.target.value }))}
              >
                <option value="">— nepoznato —</option>
                {partners.map((partner) => (
                  <option key={partner.id} value={partner.id}>{partner.code} · {partner.name}</option>
                ))}
              </Select>
              <div className="gx-cols">
                <Input
                  label="Pobjednička cijena"
                  id="out-winner-value"
                  value={form.winnerValueAmount}
                  onChange={(e) => setForm((f) => ({ ...f, winnerValueAmount: e.target.value }))}
                />
                <Input
                  label="Broj ponuda"
                  id="out-bidders"
                  type="number"
                  min={1}
                  value={form.biddersCount}
                  onChange={(e) => setForm((f) => ({ ...f, biddersCount: e.target.value }))}
                />
                <Input
                  label="Naš rang"
                  id="out-rank"
                  type="number"
                  min={1}
                  value={form.ourRank}
                  onChange={(e) => setForm((f) => ({ ...f, ourRank: e.target.value }))}
                />
              </div>
              <Textarea
                label="Napomena"
                id="out-note"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
              <div className="gx-dialog__actions">
                <Button variant="quiet" onClick={() => setShowForm(false)} disabled={busy}>Otkaži</Button>
                <Button variant="primary" onClick={() => void save()} disabled={busy || !canSave}>
                  {busy ? "Čuvam…" : "Zapiši ishod"}
                </Button>
              </div>
            </Stack>
          </div>
        ) : (
          <Button variant="primary" onClick={() => setShowForm(true)}>Upiši ishod</Button>
        )
      ) : null}

      {!caps.canOutcome && !outcome ? (
        <p className="gx-page-sub">Ishod upisuje vođa projekta, administrator ili vlasnik.</p>
      ) : null}
    </Stack>
  );
}

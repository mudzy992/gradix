"use client";

import { useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Chip, DescriptionList, Input, Mono, Select, Stack, Textarea,
} from "@/components/ui/index";
import type { TenderRow, TenderStatus } from "@gradix/contracts";
import {
  deadlineText,
  deadlineTone,
  formatDate,
  formatDateTime,
  formatTenderValue,
  SOURCE_LABEL,
  STATUS_LABEL,
} from "../tenders-shared";

/**
 * Tab „Pregled“: datumi i rokovi, izvor, odluka o učešću i promjena statusa.
 *
 * Odluka je jedan dijalog (DA/NE + razlog), a ne tri PATCH-a (§1.1/3): bez odluke nema
 * prelaska u pripremu, pa je bolje da korisnik vidi cijelu odluku na jednom mjestu.
 */
export function TenderOverviewTab({
  tender,
  nextStatuses,
  caps,
  onChanged,
}: {
  tender: TenderRow;
  nextStatuses: readonly TenderStatus[];
  caps: { canManage: boolean; canPrice: boolean; canApprovePrice: boolean; canOutcome: boolean };
  onChanged: () => void;
}) {
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [decision, setDecision] = useState({ participate: true, reason: "" });
  const [editDates, setEditDates] = useState(false);
  const [dates, setDates] = useState({
    deadlineAt: toLocalInput(tender.deadlineAt),
    questionsDeadlineAt: toLocalInput(tender.questionsDeadlineAt),
    siteVisitAt: toLocalInput(tender.siteVisitAt),
    openedAt: toLocalInput(tender.openedAt),
    externalRef: tender.externalRef ?? "",
    portalName: tender.portalName ?? "",
    source: tender.source ?? "",
  });

  const setStatus = async (status: TenderStatus) => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall(`/api/tenders/${tender.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice({ tone: "success", text: `Status: ${STATUS_LABEL[status]}.` });
    onChanged();
  };

  const saveDecision = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall(`/api/tenders/${tender.id}/decision`, jsonBody(decision));
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setDeciding(false);
    setNotice({
      tone: "success",
      text: decision.participate ? "Odluka: učestvujemo." : "Odluka: ne učestvujemo — tender je otkazan.",
    });
    onChanged();
  };

  const saveDates = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall(`/api/tenders/${tender.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deadlineAt: dates.deadlineAt ? new Date(dates.deadlineAt).toISOString() : null,
        questionsDeadlineAt: dates.questionsDeadlineAt
          ? new Date(dates.questionsDeadlineAt).toISOString()
          : null,
        siteVisitAt: dates.siteVisitAt ? new Date(dates.siteVisitAt).toISOString() : null,
        openedAt: dates.openedAt ? new Date(dates.openedAt).toISOString() : null,
        externalRef: dates.externalRef.trim() || null,
        portalName: dates.portalName.trim() || null,
        source: dates.source || null,
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setEditDates(false);
    setNotice({ tone: "success", text: "Podaci su sačuvani." });
    onChanged();
  };

  return (
    <Stack>
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}

      <DescriptionList
        items={[
          {
            term: "Status",
            value: (
              <Chip tone={tender.status === "WON" ? "full" : "hollow"}>
                {STATUS_LABEL[tender.status]}
              </Chip>
            ),
          },
          { term: "Naručilac", value: tender.partnerName },
          {
            term: "Vrijednost ponude",
            value: <Mono>{formatTenderValue(tender.submittedValueAmount, tender.currencyCode)}</Mono>,
          },
          {
            term: "Procjena naručioca",
            value: tender.estimatedValueAmount ? (
              <Mono>{formatTenderValue(tender.estimatedValueAmount, tender.currencyCode)}</Mono>
            ) : "—",
          },
          {
            term: "Rok dostave",
            value: (
              <span>
                {formatDateTime(tender.deadlineAt)}
                {tender.daysToDeadline !== null ? (
                  <>
                    {" "}
                    <Chip tone={deadlineTone(tender.daysToDeadline) === "danger" ? "hot" : "hollow"}>
                      {deadlineText(tender.daysToDeadline, tender.deadlineAt)}
                    </Chip>
                  </>
                ) : null}
              </span>
            ),
          },
          { term: "Rok za pitanja", value: formatDateTime(tender.questionsDeadlineAt) },
          { term: "Obilazak lokacije", value: formatDateTime(tender.siteVisitAt) },
          { term: "Otvaranje ponuda", value: formatDateTime(tender.openedAt) },
          {
            term: "Izvor",
            value: tender.source ? SOURCE_LABEL[tender.source] ?? tender.source : "—",
          },
          { term: "Portal", value: tender.portalName ?? "—" },
          { term: "Referentni broj", value: <Mono>{tender.externalRef ?? "—"}</Mono> },
          {
            term: "Odluka o učešću",
            value:
              tender.participate === null ? (
                "Nije donesena"
              ) : (
                <span>
                  {tender.participate ? "Učestvujemo" : "Ne učestvujemo"}
                  {tender.decidedByName ? ` · ${tender.decidedByName}` : ""}
                  {tender.decidedAt ? ` · ${formatDate(tender.decidedAt)}` : ""}
                  {tender.decisionReason ? <div className="gx-page-sub">{tender.decisionReason}</div> : null}
                </span>
              ),
          },
          { term: "Predano", value: formatDate(tender.submittedAt) },
          {
            term: "Projekat",
            value: tender.convertedProjectId ? (
              <a className="gx-link" href={`/ured/projekti/${tender.convertedProjectId}`}>Otvori projekat</a>
            ) : (
              "—"
            ),
          },
          { term: "Napomena", value: tender.note ?? "—" },
        ]}
      />

      {caps.canManage && tender.status === "GO_NO_GO" && tender.participate === null ? (
        <div className="gx-card">
          <h3 className="gx-section-title">Odluka o učešću</h3>
          <p className="gx-page-sub">
            Bez odluke tender ne može u pripremu. „Ne“ odmah otkazuje tender i upisuje razlog.
          </p>
          {deciding ? (
            <Stack>
              <Select
                label="Odluka"
                id="tnd-decide"
                value={decision.participate ? "yes" : "no"}
                onChange={(e) =>
                  setDecision((d) => ({ ...d, participate: e.target.value === "yes" }))
                }
              >
                <option value="yes">Učestvujemo (DA)</option>
                <option value="no">Ne učestvujemo (NE)</option>
              </Select>
              <Textarea
                label="Razlog odluke"
                id="tnd-decide-reason"
                value={decision.reason}
                onChange={(e) => setDecision((d) => ({ ...d, reason: e.target.value }))}
                required
              />
              <div className="gx-dialog__actions">
                <Button variant="quiet" onClick={() => setDeciding(false)} disabled={busy}>Otkaži</Button>
                <Button
                  variant="primary"
                  onClick={() => void saveDecision()}
                  disabled={busy || decision.reason.trim().length < 3}
                >
                  {busy ? "Čuvam…" : "Zapamti odluku"}
                </Button>
              </div>
            </Stack>
          ) : (
            <Button variant="primary" onClick={() => setDeciding(true)}>Donesi odluku</Button>
          )}
        </div>
      ) : null}

      {caps.canManage ? (
        <div className="gx-card">
          <h3 className="gx-section-title">Rokovi i izvor</h3>
          {editDates ? (
            <Stack>
              <div className="gx-cols">
                <Input
                  label="Rok dostave"
                  id="tnd-e-deadline"
                  type="datetime-local"
                  value={dates.deadlineAt}
                  onChange={(e) => setDates((d) => ({ ...d, deadlineAt: e.target.value }))}
                />
                <Input
                  label="Rok za pitanja"
                  id="tnd-e-questions"
                  type="datetime-local"
                  value={dates.questionsDeadlineAt}
                  onChange={(e) => setDates((d) => ({ ...d, questionsDeadlineAt: e.target.value }))}
                />
              </div>
              <div className="gx-cols">
                <Input
                  label="Obilazak lokacije"
                  id="tnd-e-visit"
                  type="datetime-local"
                  value={dates.siteVisitAt}
                  onChange={(e) => setDates((d) => ({ ...d, siteVisitAt: e.target.value }))}
                />
                <Input
                  label="Otvaranje ponuda"
                  id="tnd-e-open"
                  type="datetime-local"
                  value={dates.openedAt}
                  onChange={(e) => setDates((d) => ({ ...d, openedAt: e.target.value }))}
                />
              </div>
              <div className="gx-cols">
                <Input
                  label="Portal"
                  id="tnd-e-portal"
                  value={dates.portalName}
                  onChange={(e) => setDates((d) => ({ ...d, portalName: e.target.value }))}
                />
                <Input
                  label="Referentni broj"
                  id="tnd-e-ref"
                  value={dates.externalRef}
                  onChange={(e) => setDates((d) => ({ ...d, externalRef: e.target.value }))}
                />
              </div>
              <Select
                label="Izvor"
                id="tnd-e-source"
                value={dates.source}
                onChange={(e) => setDates((d) => ({ ...d, source: e.target.value }))}
              >
                <option value="">— nepoznato —</option>
                <option value="PORTAL">Portal</option>
                <option value="INVITATION">Poziv naručioca</option>
                <option value="DIRECT">Direktno</option>
                <option value="OTHER">Ostalo</option>
              </Select>
              <div className="gx-dialog__actions">
                <Button variant="quiet" onClick={() => setEditDates(false)} disabled={busy}>Otkaži</Button>
                <Button variant="primary" onClick={() => void saveDates()} disabled={busy}>
                  {busy ? "Čuvam…" : "Sačuvaj"}
                </Button>
              </div>
            </Stack>
          ) : (
            <Button onClick={() => setEditDates(true)}>Uredi rokove i izvor</Button>
          )}
        </div>
      ) : null}

      {caps.canManage && nextStatuses.length > 0 ? (
        <div className="gx-card">
          <h3 className="gx-section-title">Sljedeći korak</h3>
          <p className="gx-page-sub">
            Predaja traži rok dostave i kompletnu kontrolnu listu; zatvaranje traži upisan ishod.
          </p>
          <div className="gx-inline-flex">
            {nextStatuses.map((status) => (
              <Button key={status} disabled={busy} onClick={() => void setStatus(status)}>
                Označi: {STATUS_LABEL[status]}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </Stack>
  );
}

/** ISO u vrijednost za `datetime-local` (bez zone, lokalno vrijeme). */
function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

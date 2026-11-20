"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/api-client";
import {
  Alert, Button, Chip, DescriptionList, Mono, PageHeader, Stack,
} from "@/components/ui/index";
import type { TenderRow, TenderStatus } from "@gradix/contracts";
import type { TenderAttachmentRow } from "@/server/tender-attachment-service";
import type { ObligationRow } from "@/server/obligation-service";
import { formatTenderValue, STATUS_LABEL } from "../tenders-shared";

type Caps = { canManage: boolean; canConvert: boolean };

const NEXT_STATUS: Partial<Record<TenderStatus, TenderStatus[]>> = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["WON", "LOST", "WITHDRAWN"],
};

export function TenderDetailClient({
  tender,
  initialAttachments,
  initialObligations,
  caps,
}: {
  tender: TenderRow;
  initialAttachments: TenderAttachmentRow[];
  initialObligations: ObligationRow[];
  caps: Caps;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const setStatus = async (status: TenderStatus) => {
    setBusy(true);
    const result = await apiCall(`/api/tenders/${tender.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (!result.ok) { setNotice({ tone: "error", text: result.message }); return; }
    setNotice({ tone: "success", text: `Status: ${STATUS_LABEL[status]}.` });
    router.refresh();
  };

  const convert = async () => {
    setBusy(true);
    const result = await apiCall(`/api/tenders/${tender.id}/convert`, { method: "POST" });
    setBusy(false);
    if (!result.ok) { setNotice({ tone: "error", text: result.message }); return; }
    setNotice({ tone: "success", text: "Pretvoreno u projekat." });
    router.refresh();
  };

  const next = NEXT_STATUS[tender.status] ?? [];

  return (
    <Stack>
      <PageHeader
        title={tender.title}
        subtitle={`${STATUS_LABEL[tender.status]} · ${tender.partnerName}`}
        actions={
          caps.canConvert && tender.status === "WON" && !tender.convertedProjectId ? (
            <Button variant="primary" disabled={busy} onClick={() => void convert()}>
              Pretvori u projekat
            </Button>
          ) : undefined
        }
      />
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}
      <DescriptionList
        items={[
          { term: "Status", value: <Chip tone={tender.status === "WON" ? "full" : "hollow"}>{STATUS_LABEL[tender.status]}</Chip> },
          { term: "Naručilac", value: tender.partnerName },
          {
            term: "Vrijednost ponude",
            value: <Mono>{formatTenderValue(tender.submittedValueAmount, tender.currencyCode)}</Mono>,
          },
          {
            term: "Predano",
            value: tender.submittedAt ? new Date(tender.submittedAt).toLocaleDateString("bs-BA") : "—",
          },
          {
            term: "Projekat",
            value: tender.convertedProjectId ? (
              <a href={`/ured/projekti`}>{tender.convertedProjectId}</a>
            ) : "—",
          },
          { term: "Napomena", value: tender.note ?? "—" },
        ]}
      />
      {caps.canManage && next.length > 0 ? (
        <div className="gx-inline" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
          {next.map((status) => (
            <Button key={status} disabled={busy} onClick={() => void setStatus(status)}>
              Označi: {STATUS_LABEL[status]}
            </Button>
          ))}
        </div>
      ) : null}
      <section>
        <h2 className="gx-section-title">Prilozi</h2>
        {initialAttachments.length === 0 ? (
          <p className="gx-page-sub">Nema priloga.</p>
        ) : (
          <ul className="gx-stack">
            {initialAttachments.map((att) => (
              <li key={att.id}>
                <Mono>{att.fileName}</Mono>
                {" · "}
                {att.status === "ready" ? "spreman" : "na čekanju"}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="gx-section-title">Rokovi (tender)</h2>
        {initialObligations.length === 0 ? (
          <p className="gx-page-sub">
            Nema obaveza na ovom tenderu. Dodajte ih na{" "}
            <a href={`/ured/rokovi?entityKind=TENDER`}>Rokovima</a>.
          </p>
        ) : (
          <ul className="gx-stack">
            {initialObligations.map((obl) => (
              <li key={obl.id}>
                {obl.typeLabel}
                {obl.expiresAt ? ` · rok ${obl.expiresAt}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Button variant="quiet" onClick={() => router.push("/ured/tenderi")}>← Nazad na listu</Button>
    </Stack>
  );
}

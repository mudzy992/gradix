"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Button, PageHeader, Stack, Tabs,
} from "@/components/ui/index";
import type {
  TenderBoqItemRow,
  TenderCalculation,
  TenderChecklistItemRow,
  TenderOutcomeRow,
  TenderPriceRevisionRow,
  TenderResourceRow,
  TenderRow,
  TenderStatus,
} from "@gradix/contracts";
import type { TenderAttachmentRow } from "@/server/tender-attachment-service";
import type { ObligationRow } from "@/server/obligation-service";
import { STATUS_LABEL, formatDate, formatDateTime, formatTenderValue } from "../tenders-shared";
import { TenderOverviewTab } from "./tender-overview-tab";
import { TenderCalculationTab } from "./tender-calculation-tab";
import { TenderDocumentsTab } from "./tender-documents-tab";
import { TenderOutcomeTab } from "./tender-outcome-tab";
import { TenderConversionTab } from "./tender-conversion-tab";
import { TenderTeamTab, type TenderPhaseRow } from "./tender-team-tab";

export type TenderCaps = {
  canManage: boolean;
  canConvert: boolean;
  canPrice: boolean;
  canApprovePrice: boolean;
  canOutcome: boolean;
};

type TabKey = "overview" | "calculation" | "documents" | "attachments" | "outcome" | "team" | "conversion";

/**
 * Detalj tendera sa tabovima (spec 08 §4).
 *
 * Tabovi su filter po PITANJU, ne po tabeli: „gdje stojim“ (Pregled), „koliko vrijedi“
 * (Kalkulacija), „šta nedostaje“ (Dokumenti), „šta je priloženo“ (Prilozi), „kako je prošlo“
 * (Ishod), „ko radi“ (Tim), „pretvori“ (Konverzija). Tab koji rola ne smije vidjeti se ne
 * prikazuje — prazna tabela bi izgledala kao da podataka nema.
 */
export function TenderDetailClient({
  tender,
  nextStatuses,
  initialAttachments,
  initialObligations,
  initialChecklist,
  initialBlocking,
  initialCalculation,
  initialBoq,
  initialResources,
  initialRevisions,
  initialOutcome,
  initialTeam,
  initialPhases,
  caps,
}: {
  tender: TenderRow;
  nextStatuses: readonly TenderStatus[];
  initialAttachments: TenderAttachmentRow[];
  initialObligations: ObligationRow[];
  initialChecklist: TenderChecklistItemRow[];
  initialBlocking: string[];
  initialCalculation: TenderCalculation | null;
  initialBoq: TenderBoqItemRow[];
  initialResources: TenderResourceRow[];
  initialRevisions: TenderPriceRevisionRow[];
  initialOutcome: TenderOutcomeRow | null;
  initialTeam: Array<{ workerId: string; name: string; role: string }>;
  initialPhases: TenderPhaseRow[];
  caps: TenderCaps;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("overview");
  const refresh = () => router.refresh();

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "overview", label: "Pregled" },
    ...(caps.canPrice ? [{ key: "calculation" as TabKey, label: "Kalkulacija" }] : []),
    { key: "documents", label: "Dokumenti" },
    { key: "attachments", label: "Prilozi" },
    { key: "outcome", label: "Ishod" },
    { key: "team", label: "Tim" },
    { key: "conversion", label: "Konverzija" },
  ];

  return (
    <Stack>
      <PageHeader
        title={tender.title}
        subtitle={`${STATUS_LABEL[tender.status]} · ${tender.partnerName} · ${formatTenderValue(
          tender.submittedValueAmount,
          tender.currencyCode,
        )}`}
        actions={<Link className="gx-link" href="/ured/tenderi">← Nazad na listu</Link>}
      />

      <Tabs tabs={tabs} active={tab} onChange={(key) => setTab(key as TabKey)} label="Dijelovi tendera" />

      {tab === "overview" ? (
        <TenderOverviewTab
          tender={tender}
          nextStatuses={nextStatuses}
          caps={{
            canManage: caps.canManage,
            canPrice: caps.canPrice,
            canApprovePrice: caps.canApprovePrice,
            canOutcome: caps.canOutcome,
          }}
          onChanged={refresh}
        />
      ) : null}

      {tab === "calculation" && caps.canPrice ? (
        <TenderCalculationTab
          tenderId={tender.id}
          initialCalculation={initialCalculation}
          initialBoq={initialBoq}
          initialResources={initialResources}
          initialRevisions={initialRevisions}
          caps={{ canPrice: caps.canPrice, canApprovePrice: caps.canApprovePrice }}
        />
      ) : null}

      {tab === "documents" ? (
        <TenderDocumentsTab
          tenderId={tender.id}
          initialItems={initialChecklist}
          initialBlocking={initialBlocking}
          attachments={initialAttachments.map((att) => ({
            id: att.id,
            fileName: att.fileName,
            status: att.status,
          }))}
          caps={{ canManage: caps.canManage }}
        />
      ) : null}

      {tab === "attachments" ? (
        <Stack>
          <h2 className="gx-section-title">Prilozi</h2>
          {initialAttachments.length === 0 ? (
            <p className="gx-page-sub">Nema priloga na ovom tenderu.</p>
          ) : (
            <ul className="gx-stack">
              {initialAttachments.map((att) => (
                <li key={att.id}>
                  <strong>{att.fileName}</strong>
                  {" · "}
                  {att.status === "ready" ? "spreman" : "na čekanju"}
                  {" · "}
                  {formatDate(att.createdAt)}
                </li>
              ))}
            </ul>
          )}
          <h2 className="gx-section-title">Rokovi na tenderu</h2>
          {initialObligations.length === 0 ? (
            <p className="gx-page-sub">
              Nema obaveza na tenderu. Rokovi za predaju i pitanja nastaju automatski pri prelasku
              u pripremu.
            </p>
          ) : (
            <ul className="gx-stack">
              {initialObligations.map((obligation) => (
                <li key={obligation.id}>
                  {obligation.typeLabel}
                  {obligation.expiresAt ? ` · rok ${obligation.expiresAt}` : ""}
                  {obligation.state ? ` · ${obligation.state}` : ""}
                </li>
              ))}
            </ul>
          )}
          <Link className="gx-link" href="/ured/rokovi?entityKind=TENDER">Otvori sve tenderske rokove →</Link>
        </Stack>
      ) : null}

      {tab === "outcome" ? (
        <TenderOutcomeTab
          tender={tender}
          initialOutcome={initialOutcome}
          partners={[]}
          caps={{ canOutcome: caps.canOutcome, canManage: caps.canManage }}
          onChanged={refresh}
        />
      ) : null}

      {tab === "team" ? <TenderTeamTab team={initialTeam} phases={initialPhases} /> : null}

      {tab === "conversion" ? (
        <TenderConversionTab tender={tender} caps={{ canConvert: caps.canConvert }} onChanged={refresh} />
      ) : null}

      <p className="gx-page-sub">
        Rok dostave: {formatDateTime(tender.deadlineAt)} · Predano: {formatDate(tender.submittedAt)} ·
        Revizija: {tender.currentRevision > 0 ? `#${tender.currentRevision}` : "nema"}
      </p>
      <Button variant="quiet" onClick={refresh}>Osvježi</Button>
    </Stack>
  );
}

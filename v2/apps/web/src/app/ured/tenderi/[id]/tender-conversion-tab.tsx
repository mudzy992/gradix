"use client";

import { useState } from "react";
import Link from "next/link";
import { apiCall } from "@/api-client";
import { Alert, Button, DescriptionList, Stack } from "@/components/ui/index";
import type { TenderRow } from "@gradix/contracts";
import { STATUS_LABEL } from "../tenders-shared";

/**
 * Tab „Konverzija“: jedan klik WON → projekat (spec 08 §1.6).
 *
 * Ekran ne nudi djelimičnu konverziju i ne pita šta prenijeti — jer djelimična konverzija ne
 * postoji. Ako tender nije `WON`, dugmeta nema i piše zašto; ako je već pretvoren, piše koji
 * projekat i nudi link (a ne drugi pokušaj koji bi vratio `ALREADY_CONVERTED`).
 */
export function TenderConversionTab({
  tender,
  caps,
  onChanged,
}: {
  tender: TenderRow;
  caps: { canConvert: boolean };
  onChanged: () => void;
}) {
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{
    boqItems: number; phases: number; obligations: number; attachments: number; teamMembers: number;
  } | null>(null);

  const convert = async () => {
    setBusy(true);
    setNotice(null);
    const result = await apiCall<{
      outcome: string;
      projectId?: string;
      summary?: { boqItems: number; phases: number; obligations: number; attachments: number; teamMembers: number };
    }>(`/api/tenders/${tender.id}/convert`, { method: "POST" });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setSummary(result.data.summary ?? null);
    setNotice({ tone: "success", text: "Tender je pretvoren u projekat." });
    onChanged();
  };

  return (
    <Stack>
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}

      <DescriptionList
        items={[
          { term: "Status tendera", value: STATUS_LABEL[tender.status] },
          {
            term: "Projekat",
            value: tender.convertedProjectId ? (
              <Link className="gx-link" href={`/ured/projekti/${tender.convertedProjectId}`}>
                Otvori projekat
              </Link>
            ) : "—",
          },
        ]}
      />

      {tender.convertedProjectId ? (
        <p className="gx-page-sub">
          Tender je već pretvoren. Ponovni pokušaj vraća <code>ALREADY_CONVERTED</code> — jedan
          tender daje tačno jedan projekat.
        </p>
      ) : tender.status !== "WON" ? (
        <p className="gx-page-sub">
          Konverzija je moguća samo za status „Dobijeno“. Trenutno: {STATUS_LABEL[tender.status]}.
        </p>
      ) : caps.canConvert ? (
        <div className="gx-card">
          <h3 className="gx-section-title">Pretvori u projekat</h3>
          <p className="gx-page-sub">
            Prenosi se sve odjednom ili ništa: vrijednost ugovora iz odobrene revizije, predmjer 1:1
            sa jediničnim cijenama, faze, obaveze izvođenja, reference priloga i predloženi tim.
          </p>
          <Button variant="primary" disabled={busy} onClick={() => void convert()}>
            {busy ? "Pretvaram…" : "Pretvori u projekat"}
          </Button>
        </div>
      ) : (
        <p className="gx-page-sub">Konverziju pokreće vođa projekta, administrator ili vlasnik.</p>
      )}

      {summary ? (
        <div className="gx-card">
          <h3 className="gx-section-title">Šta je preneseno</h3>
          <DescriptionList
            items={[
              { term: "Stavke predmjera", value: String(summary.boqItems) },
              { term: "Faze", value: String(summary.phases) },
              { term: "Obaveze izvođenja", value: String(summary.obligations) },
              { term: "Prilozi (nove veze)", value: String(summary.attachments) },
              { term: "Predloženi članovi tima", value: String(summary.teamMembers) },
            ]}
          />
        </div>
      ) : null}
    </Stack>
  );
}

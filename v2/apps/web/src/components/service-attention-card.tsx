import Link from "next/link";
import { Card } from "@/components/ui/index";
import type { ServiceAttention } from "@/server/service-attention";

/**
 * Kartica „Servis“ na Pregledu (F8).
 *
 * Brojeve dobija iz `serviceAttention`, koji dospjele planove čita istom funkcijom kao worker —
 * pa podsjetnik i ekran ne mogu reći različito „dospjelo“.
 *
 * Redoslijed je hitnost: pređen rok (crveno) prije „blizu roka“ (žuto), a čekanje dijelova prije
 * čekanja odobrenja — dio koji nije stigao je stvarni zastoj, odobrenje je samo odluka.
 */
export function ServiceAttentionCard({ data }: { data: ServiceAttention }) {
  const rows = [
    {
      key: "overdue",
      tone: data.overdue > 0 ? "danger" : "neutral",
      label: "preventivni servis prešao rok",
      count: data.overdue,
      href: "/ured/servis/planovi",
    },
    {
      key: "dueSoon",
      tone: data.dueSoon > 0 ? "warn" : "neutral",
      label: "servis blizu roka",
      count: data.dueSoon,
      href: "/ured/servis/planovi",
    },
    {
      key: "waitingParts",
      tone: data.waitingParts > 0 ? "warn" : "neutral",
      label: "nalog čeka dijelove",
      count: data.waitingParts,
      href: "/ured/servis?status=WAITING_PARTS",
    },
    {
      key: "awaitingApproval",
      tone: data.awaitingApproval > 0 ? "warn" : "neutral",
      label: "nalog čeka odobrenje",
      count: data.awaitingApproval,
      href: "/ured/servis?status=PLANNED",
    },
  ].filter((row) => row.count > 0);

  if (rows.length === 0) {
    return (
      <Card>
        <div className="gx-section-head">
          <div className="gx-section-head__text">
            <h2 className="gx-section-title">Servis</h2>
            <span className="gx-section-hint">preventiva, nalozi koji čekaju</span>
          </div>
          <Link className="gx-btn gx-btn--quiet" href="/ured/servis">
            Otvori radionicu
          </Link>
        </div>
        <p className="gx-page-sub">Ništa ne čeka: nijedan plan nije pri pragu, nijedan nalog ne stoji.</p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="gx-section-head">
        <div className="gx-section-head__text">
          <h2 className="gx-section-title">Servis</h2>
          <span className="gx-section-hint">preventiva, nalozi koji čekaju</span>
        </div>
        <Link className="gx-btn gx-btn--quiet" href="/ured/servis">
          Otvori radionicu
        </Link>
      </div>
      <ul className="gx-summary-list">
        {rows.map((row) => (
          <li key={row.key}>
            <Link href={row.href} className="gx-summary-link">
              <span className={`gx-summary-value gx-mono${row.tone === "danger" ? " gx-summary-value--danger" : ""}`}>
                {row.count}
              </span>
              <span>{row.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      {data.examples.length > 0 ? (
        <ul className="gx-summary-hints">
          {data.examples.map((example) => (
            <li key={example.planId}>
              {example.machineName} — {example.name}
              {example.due ? ` (rok ${example.due})` : ""}
              {example.status === "OVERDUE" ? " · pređen rok" : " · blizu roka"}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

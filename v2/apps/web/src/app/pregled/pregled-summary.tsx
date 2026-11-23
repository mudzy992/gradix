import type { PregledResponse } from "@gradix/contracts";
import { Card } from "@/components/ui/index";

/** R6.2: Sažetak — dashboard agregati ili klasični brojevi (isti gx-summary-list). */
export function PregledSummaryCard({ data }: { data: PregledResponse }) {
  const hint = data.dashboard
    ? `period ${data.dashboard.periodFrom} – ${data.dashboard.periodTo}`
    : data.scope === "projects"
      ? "svijet u vašem opsegu"
      : "stanje firme na prvi pogled";

  return (
    <Card>
      <div className="gx-section-head">
        <div className="gx-section-head__text">
          <h2 className="gx-section-title">Sažetak</h2>
          <span className="gx-section-hint">{hint}</span>
        </div>
      </div>
      <ul className="gx-summary-list">
        {data.dashboard ? (
          <>
            <li>
              <span className="gx-summary-value gx-mono">{data.dashboard.activeProjects}</span>
              <span className="gx-summary-label">aktivni projekti</span>
            </li>
            <li>
              <span className="gx-summary-value gx-mono">
                {data.dashboard.bookedCostsAmount} {data.dashboard.bookedCostsCurrency}
              </span>
              <span className="gx-summary-label">knjiženi troškovi</span>
            </li>
            <li>
              <span className="gx-summary-value gx-mono">{data.dashboard.hoursInPeriod}</span>
              <span className="gx-summary-label">sati (LOCKED/CONFIRMED)</span>
            </li>
          </>
        ) : (
          <>
            <li>
              <span className="gx-summary-value gx-mono">{data.summary.activeProjects}</span>
              <span className="gx-summary-label">aktivni projekti</span>
            </li>
            <li>
              <span className="gx-summary-value gx-mono">{data.summary.activeWorkers}</span>
              <span className="gx-summary-label">aktivni radnici</span>
            </li>
            <li>
              <span className="gx-summary-value gx-mono">{data.summary.activeMachines}</span>
              <span className="gx-summary-label">mašine</span>
            </li>
            <li>
              <span className="gx-summary-value gx-mono">{data.summary.entriesThisWeek}</span>
              <span className="gx-summary-label">unosi rada ovaj tjedan</span>
            </li>
          </>
        )}
      </ul>
    </Card>
  );
}

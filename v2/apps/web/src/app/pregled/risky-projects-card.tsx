import Link from "next/link";
import { Card, Chip, Inline, Stat } from "@/components/ui/index";
import type { RiskyProjectRow, RiskyProjectsResult } from "@/server/risky-projects-types";

/**
 * Top 5 rizičnih projekata + broj troškova bez cijene (spec 06 §1.7.28).
 *
 * Rizik se IMENUJE, ne boji: „negativna marža“, „preko budžeta“, „trošak bez cijene“. Osoba koja
 * vidi samo crvenu tačku ne zna šta da uradi; imenovan uzrok vodi na ekran gdje se rješava.
 *
 * `PENDING` je prikazan kao BROJ zapisa, odvojeno — nikad sabran sa novcem (§1.8.29).
 */
const RISK_LABEL: Record<RiskyProjectRow["risks"][number], string> = {
  NEGATIVE_MARGIN: "negativna marža",
  OVER_BUDGET: "preko budžeta",
  PENDING_COSTS: "trošak bez cijene",
};

export function RiskyProjectsCard({ data }: { data: RiskyProjectsResult }) {
  return (
    <Card>
      <div className="gx-section-head">
        <div className="gx-section-head__text">
          <h2 className="gx-section-title">Rizični projekti</h2>
          <span className="gx-section-hint">gdje novac izlazi iz plana — najveći gubitak prvi</span>
        </div>
      </div>

      <Inline>
        <Stat
          label="Troškovi bez cijene"
          value={String(data.pending_cost_count)}
          hint="Broj zapisa, ne iznos — bez cijene se ne sabira."
        />
      </Inline>

      {data.projects.length === 0 ? (
        <p className="gx-page-sub">Nijedan projekat nije u riziku po marži, budžetu ni cijeni.</p>
      ) : (
        <ul className="gx-stack gx-stack--2">
          {data.projects.map((project) => (
            <li key={project.id} className="gx-inline-flex">
              <Link href={`/ured/projekti?projekat=${project.id}`}>
                <strong>
                  {project.code} · {project.name}
                </strong>
              </Link>
              {project.margin === null ? null : <span>{project.margin}</span>}
              {project.margin_pct === null ? null : (
                <Chip tone={project.margin_pct < 0 ? "hot" : "hollow"}>{project.margin_pct.toFixed(1)} %</Chip>
              )}
              {project.budget_used_pct === null ? null : (
                <span className="gx-page-sub">budžet {project.budget_used_pct.toFixed(0)} %</span>
              )}
              <span className="gx-page-sub">
                {project.risks.map((risk) => RISK_LABEL[risk]).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

import Link from "next/link";
import { Card } from "@/components/ui/index";
import type { HseAttention } from "@/server/hse-service";

/**
 * Kartica „Zaštita na radu“ na Pregledu (spec 10 §1.5/25, §4).
 *
 * Redoslijed je hitnost, ne vrsta: **aktivna zabrana rada** prva (gradilište stoji), pa mjere koje
 * kasne (zakonski rok), pa otvoreni incidenti, pa dnevnik bez potpisa. Nule se ne prikazuju — red
 * sa nulom troši pažnju na isto koliko i red sa sedam.
 *
 * Kartice NEMA bez `hse.view`: prazna kartica bi tvrdila da problema nema, a to je tvrdnja koju
 * ekran ne smije dati umjesto čovjeka.
 */
export function HseAttentionCard({ data }: { data: HseAttention }) {
  const rows = [
    {
      key: "prohibition",
      danger: true,
      label: `ZABRANA RADA${data.prohibition?.authorityName ? ` — ${data.prohibition.authorityName}` : ""}`,
      count: data.prohibition ? 1 : 0,
      href: "/ured/hse/inspekcije",
    },
    {
      key: "overdue",
      danger: true,
      label: "korektivna mjera kasni",
      count: data.overdueActions,
      href: "/ured/hse",
    },
    {
      key: "open",
      danger: false,
      label: "incident nije zatvoren",
      count: data.openIncidents,
      href: "/ured/hse",
    },
    {
      key: "unsigned",
      danger: false,
      label: "dnevnik bez potpisa (2+ dana)",
      count: data.unsignedDiaries,
      href: "/ured/dnevnik",
    },
  ].filter((row) => row.count > 0);

  if (rows.length === 0) {
    return (
      <Card>
        <div className="gx-section-head">
          <div className="gx-section-head__text">
            <h2 className="gx-section-title">Zaštita na radu</h2>
            <span className="gx-section-hint">incidenti, mjere, potpisi</span>
          </div>
          <Link className="gx-btn gx-btn--quiet" href="/ured/hse">
            Otvori HSE
          </Link>
        </div>
        <p className="gx-page-sub">
          Ništa ne traži pažnju: nema zabrane rada, nijedna mjera ne kasni, svi dnevnici su potpisani.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="gx-section-head">
        <div className="gx-section-head__text">
          <h2 className="gx-section-title">Zaštita na radu</h2>
          <span className="gx-section-hint">incidenti, mjere, potpisi</span>
        </div>
        <Link className="gx-btn gx-btn--quiet" href="/ured/hse">
          Otvori HSE
        </Link>
      </div>
      <ul className="gx-summary-list">
        {rows.map((row) => (
          <li key={row.key}>
            <Link href={row.href} className="gx-summary-link">
              <span className={`gx-summary-value gx-mono${row.danger ? " gx-summary-value--danger" : ""}`}>
                {row.count}
              </span>
              <span>{row.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

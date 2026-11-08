import Link from "next/link";
import { Card } from "@/components/ui";

/**
 * Kartica „Rokovi“ na pregledu.
 *
 * Brojeve NE računa sama: dobija ih iz `listObligations().counts`, istog brojanja koje koristi
 * ekran `/ured/rokovi`. Tako broj na početnoj i lista ne mogu da se raziđu (kapija R2b §7.3), a
 * „danas“ ostaje poslovni datum firme jer ga servis već izračuna.
 *
 * Zasebna komponenta (a ne dio server komponente) zato što se samo ovako može testirati bez baze.
 */
export type ObligationCounts = {
  expired: number;
  expiring: number;
  valid: number;
};

const ITEMS = [
  { key: "expired", label: "isteklo" },
  { key: "expiring", label: "uskoro istječe" },
  { key: "valid", label: "važeće" },
] as const;

export function ObligationSummary({ counts }: { counts: ObligationCounts }) {
  return (
    <Card>
      <div className="gx-section-head">
        <div className="gx-section-head__text">
          <h2 className="gx-section-title">Rokovi</h2>
          <span className="gx-section-hint">ljekarski, registracije, licence</span>
        </div>
        <Link className="gx-btn gx-btn--quiet" href="/ured/rokovi">
          Otvori rokove
        </Link>
      </div>
      <ul className="gx-summary-list">
        {ITEMS.map((item) => (
          <li key={item.key}>
            <span className="gx-summary-value gx-mono">{counts[item.key]}</span>
            <span className="gx-summary-label">{item.label}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

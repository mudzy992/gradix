import type { ReactNode } from "react";

/**
 * Odvojen shell za platformu (spec 01 §4): BEZ tenant menija.
 *
 * Operator nije član firme; ako bi vidio glavni meni, dvije stvari bi se pomiješale —
 * njegova sesija i sesija korisnika firme. Zato platforma ima svoj, mali okvir.
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <div className="gx-shell gx-shell--platform">
      <header className="gx-platform-head">
        <strong>Gradix · platforma</strong>
        <span className="gx-muted">Operatorski pristup firmama</span>
      </header>
      <div className="gx-page">{children}</div>
    </div>
  );
}

"use client";

/**
 * U1 — raspored i prikaz: zaglavlja, sekcije forme, filteri, paginacija, status.
 * DataTable živi u data-table.tsx (skrol-omotač za fiksni shell).
 */
import type { ReactNode } from "react";

export { DataTable, type DataColumn } from "./data-table";

export function Stack({ children, gap = "var(--space-4)" }: { children: ReactNode; gap?: string }) {
  return <div style={{ display: "grid", gap }}>{children}</div>;
}

export function Inline({ children, gap = "var(--space-3)" }: { children: ReactNode; gap?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap, flexWrap: "wrap" }}>{children}</div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="gx-page-head">
      <div>
        <h1 className="gx-page-title">{title}</h1>
        {subtitle ? <p className="gx-page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="gx-page-head__actions">{actions}</div> : null}
    </div>
  );
}

export function FormSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="gx-form-section">
      {title ? <h2 className="gx-form-section__title">{title}</h2> : null}
      {children}
    </section>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="gx-cols">{children}</div>;
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="gx-filters">{children}</div>;
}

export function StatusDot({ tone, label }: { tone: "ok" | "warn" | "danger" | "muted"; label: string }) {
  return (
    <span className="gx-chip">
      <span
        aria-hidden="true"
        className={`gx-chip__dot${tone === "warn" || tone === "danger" ? " gx-chip__dot--hot" : ""}${tone === "muted" ? " gx-chip__dot--hollow" : ""}`}
      />
      {label}
    </span>
  );
}

export function DescriptionList({ items }: { items: { term: string; value: ReactNode }[] }) {
  return (
    <dl className="gx-desc">
      {items.map((item) => (
        <div key={item.term} className="gx-desc__row">
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pagination({
  hasMore,
  onNext,
  onPrev,
  hasPrev,
}: {
  hasMore: boolean;
  onNext: () => void;
  onPrev: () => void;
  hasPrev: boolean;
}) {
  return (
    <div className="gx-pagination">
      <button type="button" className="gx-btn gx-btn--quiet" disabled={!hasPrev} onClick={onPrev}>
        Prethodna
      </button>
      <button type="button" className="gx-btn gx-btn--quiet" disabled={!hasMore} onClick={onNext}>
        Sljedeća
      </button>
    </div>
  );
}

/** Brojčana kartica za pregledne ploče (Pregled): oznaka, velika vrijednost, pomoć. */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="gx-card">
      <p className="gx-page-sub">{label}</p>
      <p className="gx-page-title">{value}</p>
      {hint ? <p className="gx-page-sub">{hint}</p> : null}
    </div>
  );
}

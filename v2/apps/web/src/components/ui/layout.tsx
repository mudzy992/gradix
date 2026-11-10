/**
 * U1 — raspored i prikaz: zaglavlja, sekcije forme, filteri, tabele, paginacija, status.
 * Bez inline stilova po ekranima: razmaci i mreža su ovdje (gx-* klase / tokeni).
 */
import { useMemo, useState, type ReactNode } from "react";
import type { RowAction } from "./overlays";

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

export type DataColumn<Row> = {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  numeric?: boolean;
  label?: string; // data-label za kartice ispod 640 px
  /** Sortabilna kolona: vrijednost po kojoj se redovi poređaju klikom na zaglavlje. */
  sortValue?: (row: Row) => string | number;
};

export function DataTable<Row>({
  columns, rows, rowKey, caption, empty, emptyText, emptyAction, loading, error, onRetry, actions, rowActionLabel,
}: {
  columns: DataColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  caption: string;
  empty?: ReactNode;
  emptyText?: string;
  emptyAction?: ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  actions?: (row: Row) => RowAction[];
  rowActionLabel?: (row: Row) => string;
}) {
  if (loading) return <p className="gx-page-sub">Učitavanje…</p>;
  if (error) {
    return (
      <div>
        <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>
        {onRetry ? (
          <button type="button" className="gx-btn" onClick={onRetry}>Pokušaj ponovo</button>
        ) : null}
      </div>
    );
  }
  if (rows.length === 0) {
    if (empty) return <>{empty}</>;
    if (emptyText) {
      return (
        <div className="gx-empty">
          <p className="gx-empty__title">Nema podataka</p>
          <p className="gx-empty__text">{emptyText}</p>
          {emptyAction ? <div className="gx-empty__action">{emptyAction}</div> : null}
        </div>
      );
    }
    return <p className="gx-page-sub">Nema zapisa.</p>;
  }
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sortedRows = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key && c.sortValue) : undefined;
    if (!col?.sortValue || !sort) return rows;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "bs");
      return cmp * sort.dir;
    });
  }, [rows, columns, sort]);
  const allColumns = actions
    ? [...columns, { key: "__actions", header: "Akcija", cell: () => null }]
    : columns;
  return (
    <table className="gx-table gx-table--cards" aria-label={caption}>
      <thead>
        <tr>
          {allColumns.map((col) => (
            <th
              key={col.key}
              style={col.numeric ? { textAlign: "right" } : undefined}
              aria-sort={sort?.key === col.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
            >
              {col.sortValue ? (
                <button
                  type="button"
                  className="gx-linkbtn"
                  aria-label={`Sortiraj po: ${col.header}`}
                  onClick={() => setSort((cur) => (cur?.key === col.key ? { key: col.key, dir: cur.dir === 1 ? -1 : 1 } : { key: col.key, dir: 1 }))}
                >
                  {col.header}
                  {sort?.key === col.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                </button>
              ) : (
                col.header
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((col) => (
              <td key={col.key} data-label={col.label ?? col.header}>
                {col.cell(row)}
              </td>
            ))}
            {actions ? (
              <td data-label="Akcija">
                {/* RowActions se uvozi odvojeno da layout ne zavisi od overlaysa u tipu ćelije. */}
                <RowActionsCell row={row} actions={actions} label={rowActionLabel?.(row) ?? "Akcije za red"} />
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import { RowActions } from "./overlays";
function RowActionsCell<Row>({ row, actions, label }: { row: Row; actions: (row: Row) => RowAction[]; label: string }) {
  const list = actions(row);
  if (list.length === 0) return null;
  return <RowActions label={label} actions={list} />;
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

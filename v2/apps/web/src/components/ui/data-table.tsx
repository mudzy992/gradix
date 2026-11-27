"use client";

/**
 * DataTable — lista u sklopu fiksnog shella: širina u .gx-table-scroll,
 * kartice ispod 640 px; meni reda ide kroz FloatingMenu (ne siječe ga gx-page).
 */
import { useMemo, useState, type ReactNode } from "react";
import type { RowAction } from "./overlays";
import { RowActions } from "./overlays";

export type DataColumn<Row> = {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  numeric?: boolean;
  label?: string;
  sortValue?: (row: Row) => string | number;
};

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  emptyText,
  emptyAction,
  loading,
  error,
  onRetry,
  actions,
  rowActionLabel,
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
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sortedRows = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key && c.sortValue) : undefined;
    if (!col?.sortValue || !sort) return rows;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), "bs");
      return cmp * sort.dir;
    });
  }, [rows, columns, sort]);
  if (loading) return <p className="gx-page-sub">Učitavanje…</p>;
  if (error) {
    return (
      <div>
        <p role="alert" style={{ color: "var(--danger)" }}>
          {error}
        </p>
        {onRetry ? (
          <button type="button" className="gx-btn" onClick={onRetry}>
            Pokušaj ponovo
          </button>
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
  const allColumns = actions
    ? [...columns, { key: "__actions", header: "Akcija", cell: () => null }]
    : columns;
  return (
    <div className="gx-table-scroll">
      <table className="gx-table gx-table--cards" aria-label={caption}>
        <thead>
          <tr>
            {allColumns.map((col) => (
              <th
                key={col.key}
                style={col.numeric ? { textAlign: "right" } : undefined}
                aria-sort={
                  sort?.key === col.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined
                }
              >
                {col.sortValue ? (
                  <button
                    type="button"
                    className="gx-linkbtn"
                    aria-label={`Sortiraj po: ${col.header}`}
                    onClick={() =>
                      setSort((cur) =>
                        cur?.key === col.key
                          ? { key: col.key, dir: cur.dir === 1 ? -1 : 1 }
                          : { key: col.key, dir: 1 },
                      )
                    }
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
                  <RowActions
                    label={rowActionLabel?.(row) ?? "Akcije za red"}
                    actions={actions(row)}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

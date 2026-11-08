"use client";

/**
 * Audit trag — filteri, keyset paginacija („Učitaj još“), detalj zapisa.
 *
 * Zašto keyset, a ne „stranica 2“: trag raste dok ga gledaš. Offset bi preskočio zapis koji
 * u međuvremenu nastane i duplirao onaj koji je već viđen; cursor je `createdAt|id`.
 *
 * Detalj se otvara u `<dialog>`-u (isti obrazac kao pozivnica), fokus ide u dijalog, `Escape`
 * zatvara i fokus se vraća na red koji ga je otvorio.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, EmptyState, Field, Skeleton, inputClass } from "@/components/ui";

type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type Filters = { action: string; entityType: string; actorId: string; from: string; to: string };

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: AuditRow[]; nextCursor: string | null };

const ACTION_LABELS: Record<string, string> = {
  "invitation.created": "Pozivnica poslana",
  "invitation.accepted": "Pozivnica prihvaćena",
  "invitation.revoked": "Pozivnica opozvana",
  "password.reset_issued": "Reset lozinke izdat",
  "password.reset_used": "Lozinka postavljena preko linka",
  "password.changed": "Lozinka promijenjena",
  "user.deactivated": "Osoba deaktivirana",
  "user.activated": "Osoba aktivirana",
  "user.membership_changed": "Promijenjene role ili opseg",
  "session.revoked_all": "Sve sesije ugašene",
};

const ENTITY_LABELS: Record<string, string> = {
  user: "Osoba",
  invitation: "Pozivnica",
  session: "Sesija",
};

/** Datum bez `Intl`-a: `bs-BA` u Chromiumu daje „2026 M11 7“. */
const dateTimeBs = (value: string) => {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}. u ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const EMPTY_FILTERS: Filters = { action: "", entityType: "", actorId: "", from: "", to: "" };

function toQuery(filters: Filters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.actorId.trim()) params.set("actorId", filters.actorId.trim());
  // `<input type="date">` daje `YYYY-MM-DD`; kraj dana mora uključiti cijeli dan.
  if (filters.from) params.set("from", `${filters.from}T00:00:00.000Z`);
  if (filters.to) params.set("to", `${filters.to}T23:59:59.999Z`);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export default function AuditClient({ actors }: { actors: { id: string; label: string }[] }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  // Uz zapis pamtimo dugme iz reda: fokus se vraća tamo, ne na `<body>`.
  const [open, setOpen] = useState<{ row: AuditRow; returnTo: HTMLElement | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/audit?${toQuery(filters)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setState({ kind: "error", message: body?.error?.message ?? "Ne mogu da učitam trag." });
        return;
      }
      setState({ kind: "ready", rows: body.data.rows as AuditRow[], nextCursor: body.data.nextCursor });
    } catch {
      setState({ kind: "error", message: "Nema veze sa serverom. Provjerite mrežu i pokušajte ponovo." });
    }
  }, [filters]);

  useEffect(() => {
    void load();
    // `reloadKey` mijenja identitet efekta kad korisnik klikne „Pokušaj ponovo“ bez izmjene filtera.
  }, [load, reloadKey]);

  async function loadMore() {
    if (state.kind !== "ready" || !state.nextCursor) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/audit?${toQuery(filters, state.nextCursor)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setState({ kind: "error", message: body?.error?.message ?? "Ne mogu da učitam još zapisa." });
        return;
      }
      // Dedup po `id`: ako se zapis ipak nađe na granici, ne prikazuje se dvaput.
      const seen = new Set(state.rows.map((row) => row.id));
      const merged = [...state.rows, ...(body.data.rows as AuditRow[]).filter((row) => !seen.has(row.id))];
      setState({ kind: "ready", rows: merged, nextCursor: body.data.nextCursor });
    } catch {
      setState({ kind: "error", message: "Nema veze sa serverom." });
    } finally {
      setLoadingMore(false);
    }
  }

  const hasFilter = Object.values(filters).some((value) => value.trim().length > 0);

  return (
    <div>
      <div className="gx-page-head">
        <div className="gx-page-head__text">
          <h1 className="gx-page-title">Audit trag</h1>
          <p className="gx-page-sub">Ko je šta mijenjao. Trag se ne mijenja i ne briše iz ekrana.</p>
        </div>
      </div>

      <Card>
        <div className="gx-filters">
          <Field label="Radnja" htmlFor="audit-action">
            <select
              id="audit-action"
              className={inputClass}
              value={filters.action}
              onChange={(event) => setFilters((f) => ({ ...f, action: event.target.value }))}
            >
              <option value="">Sve radnje</option>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tip zapisa" htmlFor="audit-entity">
            <select
              id="audit-entity"
              className={inputClass}
              value={filters.entityType}
              onChange={(event) => setFilters((f) => ({ ...f, entityType: event.target.value }))}
            >
              <option value="">Svi zapisi</option>
              {Object.entries(ENTITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Osoba" htmlFor="audit-actor">
            <select
              id="audit-actor"
              className={inputClass}
              value={filters.actorId}
              onChange={(event) => setFilters((f) => ({ ...f, actorId: event.target.value }))}
            >
              <option value="">Sve osobe</option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Od" htmlFor="audit-from">
            <input
              id="audit-from"
              type="date"
              className={inputClass}
              value={filters.from}
              onChange={(event) => setFilters((f) => ({ ...f, from: event.target.value }))}
            />
          </Field>

          <Field label="Do" htmlFor="audit-to">
            <input
              id="audit-to"
              type="date"
              className={inputClass}
              value={filters.to}
              onChange={(event) => setFilters((f) => ({ ...f, to: event.target.value }))}
            />
          </Field>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button variant="quiet" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!hasFilter}>
              Obriši filtere
            </Button>
          </div>
        </div>
      </Card>

      {state.kind === "loading" ? <Skeleton rows={5} /> : null}

      {state.kind === "error" ? (
        <Card>
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <Alert tone="error" role="alert">
              {state.message}
            </Alert>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button onClick={() => setReloadKey((key) => key + 1)}>Pokušaj ponovo</Button>
              {hasFilter ? <Button variant="quiet" onClick={() => setFilters(EMPTY_FILTERS)}>Obriši filtere</Button> : null}
            </div>
          </div>
        </Card>
      ) : null}

      {state.kind === "ready" && state.rows.length === 0 ? (
        <Card>
          <EmptyState
            title={hasFilter ? "Nema zapisa za ovaj filter" : "Trag je još prazan"}
            description={
              hasFilter
                ? "Promijenite filter ili ga obrišite da vidite cijeli trag."
                : "Prva radnja u firmi — pozivnica, reset ili promjena role — pojavit će se ovdje."
            }
            action={hasFilter ? <Button onClick={() => setFilters(EMPTY_FILTERS)}>Obriši filtere</Button> : undefined}
          />
        </Card>
      ) : null}

      {state.kind === "ready" && state.rows.length > 0 ? (
        <Card>
          <table className="gx-table gx-table--cards">
            <thead>
              <tr>
                <th scope="col">Kad</th>
                <th scope="col">Ko</th>
                <th scope="col">Šta</th>
                <th scope="col" style={{ textAlign: "right" }}>Detalj</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Kad" style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>
                    <span className="gx-mono">{dateTimeBs(row.createdAt)}</span>
                  </td>
                  <td data-label="Ko">{row.actorEmail ?? "sistem"}</td>
                  <td data-label="Šta">
                    {ACTION_LABELS[row.action] ?? row.action}{" "}
                    <span style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
                      · {ENTITY_LABELS[row.entityType] ?? row.entityType}
                    </span>
                  </td>
                  <td data-label="Detalj" style={{ textAlign: "right" }}>
                    <Button
                      variant="quiet"
                      onClick={(event) => setOpen({ row, returnTo: event.currentTarget })}
                    >
                      Otvori
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div
            style={{
              marginTop: "var(--space-4)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-2)",
            }}
          >
            <p style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
              Prikazano {state.rows.length}. {state.nextCursor ? "Ima još zapisa." : "To je cijeli trag za ovaj filter."}
            </p>
            {state.nextCursor ? (
              <Button onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Učitavam…" : "Učitaj još"}
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {open ? <AuditDetail row={open.row} returnFocusTo={open.returnTo} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function AuditDetail({
  row,
  returnFocusTo,
  onClose,
}: {
  row: AuditRow;
  returnFocusTo: HTMLElement | null;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Fokus ulazi u dijalog; `Escape` zatvara; fokus se vraća na dugme koje ga je otvorilo.
  useEffect(() => {
    panel.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusTo?.focus?.();
    };
  }, [onClose, returnFocusTo]);

  return (
    <div className="gx-overlay" role="presentation">
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-detail-title"
        className="gx-dialog"
        style={{ maxWidth: 560, outline: "none" }}
      >
        <h2 id="audit-detail-title" className="gx-dialog__title">
          {ACTION_LABELS[row.action] ?? row.action}
        </h2>
        <p className="gx-dialog__hint">
          <span className="gx-mono">{dateTimeBs(row.createdAt)}</span>
        </p>

        <dl style={{ marginTop: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
            <dt style={{ fontWeight: 600 }}>Osoba koja je radila</dt>
            <dd>{row.actorEmail ?? "sistem"}</dd>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
            <dt style={{ fontWeight: 600 }}>Zapis</dt>
            <dd style={{ color: "var(--muted)" }}>
              {ENTITY_LABELS[row.entityType] ?? row.entityType} · <span className="gx-mono">{row.entityId}</span>
            </dd>
          </div>
        </dl>

        <p style={{ marginTop: "var(--space-4)", marginBottom: "var(--space-1)", fontWeight: 600 }}>Detalji</p>
        <pre
          className="gx-mono"
          style={{
            maxHeight: 224,
            overflow: "auto",
            background: "var(--raise)",
            padding: "var(--space-3)",
            borderRadius: "var(--radius-field)",
            lineHeight: 1.6,
          }}
        >
          {JSON.stringify(row.metadata, null, 2)}
        </pre>

        <div className="gx-dialog__actions">
          <Button variant="primary" onClick={onClose}>
            Zatvori
          </Button>
        </div>
      </div>
    </div>
  );
}

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
import { Alert, Button, Card, EmptyState, Field, Pill, SectionTitle, Skeleton, inputClass } from "@/components/ui";

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
  const [open, setOpen] = useState<AuditRow | null>(null);
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
    <div className="grid" style={{ gap: "var(--section-gap)" }}>
      <SectionTitle hint="ko je šta mijenjao — trag se ne mijenja i ne briše iz ekrana">
        Audit trag
      </SectionTitle>

      <Card>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Radnja" htmlFor="audit-action">
            <select
              id="audit-action"
              className={inputClass}
              style={{ minHeight: "var(--control-height)" }}
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
              style={{ minHeight: "var(--control-height)" }}
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
              style={{ minHeight: "var(--control-height)" }}
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
              style={{ minHeight: "var(--control-height)" }}
              value={filters.from}
              onChange={(event) => setFilters((f) => ({ ...f, from: event.target.value }))}
            />
          </Field>

          <Field label="Do" htmlFor="audit-to">
            <input
              id="audit-to"
              type="date"
              className={inputClass}
              style={{ minHeight: "var(--control-height)" }}
              value={filters.to}
              onChange={(event) => setFilters((f) => ({ ...f, to: event.target.value }))}
            />
          </Field>

          <div className="flex items-end">
            <Button onClick={() => setFilters(EMPTY_FILTERS)} disabled={!hasFilter}>
              Obriši filtere
            </Button>
          </div>
        </div>
      </Card>

      {state.kind === "loading" ? <Skeleton rows={5} /> : null}

      {state.kind === "error" ? (
        <Card>
          <div className="grid gap-3">
            <Alert tone="error" role="alert">
              {state.message}
            </Alert>
            <div className="flex gap-2">
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
          <table className="gx-table w-full text-[var(--body-size)]">
            <thead>
              <tr className="border-b-2 border-[var(--color-border)] text-left text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
                <th scope="col" className="px-3 py-2 font-semibold">Kad</th>
                <th scope="col" className="px-3 py-2 font-semibold">Ko</th>
                <th scope="col" className="px-3 py-2 font-semibold">Šta</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-semibold">Detalj</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-brand-soft)]">
                  <td data-label="Kad" className="whitespace-nowrap text-[var(--color-text-muted)]">
                    {dateTimeBs(row.createdAt)}
                  </td>
                  <td data-label="Ko">{row.actorEmail ?? "sistem"}</td>
                  <td data-label="Šta">
                    <Pill tone="brand">{ACTION_LABELS[row.action] ?? row.action}</Pill>{" "}
                    <span className="text-[13px] text-[var(--color-text-muted)]">
                      {ENTITY_LABELS[row.entityType] ?? row.entityType}
                    </span>
                  </td>
                  <td data-label="Detalj" className="text-right">
                    <Button variant="quiet" onClick={() => setOpen(row)} className="whitespace-nowrap">
                      Otvori
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-[var(--color-text-muted)]">
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

      {open ? <AuditDetail row={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function AuditDetail({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);

  // Fokus ulazi u dijalog; `Escape` zatvara; fokus se vraća na dugme koje ga je otvorilo.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
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
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4" role="presentation">
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-detail-title"
        className="w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] bg-[var(--color-surface)] p-5 outline-none"
        style={{ maxHeight: "calc(100vh - 2rem)" }}
      >
        <h2 id="audit-detail-title" className="text-lg font-semibold">
          {ACTION_LABELS[row.action] ?? row.action}
        </h2>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">{dateTimeBs(row.createdAt)}</p>

        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="font-semibold">Osoba koja je radila</dt>
            <dd>{row.actorEmail ?? "sistem"}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="font-semibold">Zapis</dt>
            <dd className="text-[var(--color-text-muted)]">
              {ENTITY_LABELS[row.entityType] ?? row.entityType} · {row.entityId}
            </dd>
          </div>
        </dl>

        <p className="mt-4 mb-1 text-sm font-semibold">Detalji</p>
        <pre className="max-h-56 overflow-auto rounded-[10px] bg-[var(--color-surface-muted)] p-3 text-[12px] leading-relaxed">
          {JSON.stringify(row.metadata, null, 2)}
        </pre>

        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={onClose} fullWidthOnMobile>
            Zatvori
          </Button>
        </div>
      </div>
    </div>
  );
}

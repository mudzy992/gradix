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
import { useCallback, useEffect, useState } from "react";
import { apiCall } from "@/api-client";
import {
  Alert, Button, Card, DataTable, DescriptionList, Dialog, EmptyState, FilterBar,
  Input, PageHeader, Select, Skeleton, Stack,
} from "@/components/ui/index";

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
    const result = await apiCall<{ rows: AuditRow[]; nextCursor: string | null }>(`/api/audit?${toQuery(filters)}`);
    if (!result.ok) {
      setState({ kind: "error", message: result.message });
      return;
    }
    setState({ kind: "ready", rows: result.data.rows, nextCursor: result.data.nextCursor });
  }, [filters]);

  useEffect(() => {
    void load();
    // `reloadKey` mijenja identitet efekta kad korisnik klikne „Pokušaj ponovo“ bez izmjene filtera.
  }, [load, reloadKey]);

  async function loadMore() {
    if (state.kind !== "ready" || !state.nextCursor) return;
    setLoadingMore(true);
    try {
      const result = await apiCall<{ rows: AuditRow[]; nextCursor: string | null }>(`/api/audit?${toQuery(filters, state.nextCursor)}`);
      if (!result.ok) {
        setState({ kind: "error", message: result.message });
        return;
      }
      // Dedup po `id`: ako se zapis ipak nađe na granici, ne prikazuje se dvaput.
      const seen = new Set(state.rows.map((row) => row.id));
      const merged = [...state.rows, ...result.data.rows.filter((row) => !seen.has(row.id))];
      setState({ kind: "ready", rows: merged, nextCursor: result.data.nextCursor });
    } finally {
      setLoadingMore(false);
    }
  }

  const hasFilter = Object.values(filters).some((value) => value.trim().length > 0);

  return (
    <div>
      <PageHeader title="Audit trag" subtitle="Ko je šta mijenjao. Trag se ne mijenja i ne briše iz ekrana." />

      <Card>
        <FilterBar>
          <Select label="Radnja" id="audit-action"
              value={filters.action}
              onChange={(event) => setFilters((f) => ({ ...f, action: event.target.value }))}
            >
              <option value="">Sve radnje</option>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>

          <Select label="Tip zapisa" id="audit-entity"
              value={filters.entityType}
              onChange={(event) => setFilters((f) => ({ ...f, entityType: event.target.value }))}
            >
              <option value="">Svi zapisi</option>
              {Object.entries(ENTITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>

          <Select label="Osoba" id="audit-actor"
              value={filters.actorId}
              onChange={(event) => setFilters((f) => ({ ...f, actorId: event.target.value }))}
            >
              <option value="">Sve osobe</option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.label}
                </option>
              ))}
            </Select>

          <Input label="Od" id="audit-from" type="date" value={filters.from} onChange={(event) => setFilters((f) => ({ ...f, from: event.target.value }))} />
          <Input label="Do" id="audit-to" type="date" value={filters.to} onChange={(event) => setFilters((f) => ({ ...f, to: event.target.value }))} />

          <div>
            <Button variant="quiet" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!hasFilter}>
              Obriši filtere
            </Button>
          </div>
        </FilterBar>
      </Card>

      {state.kind === "loading" ? <Skeleton rows={5} /> : null}

      {state.kind === "error" ? (
        <Card>
          <Stack>
            <Alert tone="error" role="alert">
              {state.message}
            </Alert>
            <Stack>
              <Button onClick={() => setReloadKey((key) => key + 1)}>Pokušaj ponovo</Button>
              {hasFilter ? <Button variant="quiet" onClick={() => setFilters(EMPTY_FILTERS)}>Obriši filtere</Button> : null}
            </Stack>
          </Stack>
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
          <DataTable
            caption="Audit trag"
            rows={state.rows}
            rowKey={(row) => row.id}
            emptyText="Nema zapisa."
            columns={[
              { key: "when", header: "Kad", cell: (row) => <span className="gx-mono">{dateTimeBs(row.createdAt)}</span> },
              { key: "who", header: "Ko", cell: (row) => row.actorEmail ?? "sistem" },
              {
                key: "what",
                header: "Šta",
                cell: (row) => (
                  <span>
                    {ACTION_LABELS[row.action] ?? row.action}{" "}
                    <span className="gx-page-sub">· {ENTITY_LABELS[row.entityType] ?? row.entityType}</span>
                  </span>
                ),
              },
            ]}
            rowActionLabel={(row) => `Detalj zapisa ${row.id}`}
            actions={(row) => [
              { key: "open", label: "Otvori", onSelect: (returnTo) => setOpen({ row, returnTo: returnTo ?? null }) },
            ]}
          />
          <Stack>
            <p className="gx-page-sub">
              Prikazano {state.rows.length}. {state.nextCursor ? "Ima još zapisa." : "To je cijeli trag za ovaj filter."}
            </p>
            {state.nextCursor ? (
              <Button onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Učitavam…" : "Učitaj još"}
              </Button>
            ) : null}
          </Stack>
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
  return (
    <Dialog
      title={ACTION_LABELS[row.action] ?? row.action}
      hint={<span className="gx-mono">{dateTimeBs(row.createdAt)}</span>}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
      footer={(
        <div className="gx-dialog__actions">
          <Button variant="primary" onClick={onClose}>
            Zatvori
          </Button>
        </div>
      )}
    >
      <DescriptionList
        items={[
          { term: "Osoba koja je radila", value: row.actorEmail ?? "sistem" },
          {
            term: "Zapis",
            value: (
              <span>
                {ENTITY_LABELS[row.entityType] ?? row.entityType} · <span className="gx-mono">{row.entityId}</span>
              </span>
            ),
          },
        ]}
      />
      <p><strong>Detalji</strong></p>
      <pre className="gx-mono gx-codeblock">{JSON.stringify(row.metadata, null, 2)}</pre>
    </Dialog>
  );
}

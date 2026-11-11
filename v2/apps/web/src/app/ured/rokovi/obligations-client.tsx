"use client";

/**
 * Rokovi — lista obaveza, unos, obnova i prilog.
 *
 * Pravila koja ekran sprovodi (i zašto):
 *  - **Stanje se ne bira, ono se računa.** Ekran prikazuje stanje koje je vratio server, uz
 *    poslovni datum firme. Nema „označi kao isteklo“ — to bi bio podatak koji laže.
 *  - **Obnova je nova verzija.** Dijalog kaže koliko verzija postoji i da stara ostaje; broj
 *    verzija je vidljiv u redu, jer „koji je ovo put“ je pitanje koje inspektor postavi.
 *  - **Prilog se odbija po sadržaju.** Ekran računa `sha256` i prvih 32 bajta u pregledniku,
 *    pa server odbija `.exe` preimenovan u `.pdf` prije nego što bilo šta stigne u bucket.
 *  - **Stanje nije samo boja.** Chip ima tekst: „Isteklo“, „Uskoro istječe“, „Važeće“.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Obligation, ObligationStateName, ObligationType } from "@gradix/contracts";
import { apiCall } from "@/api-client";
import { formatDate } from "@/format";
import {
  Alert, Button, Card, Chip, DataTable, EmptyState, FilterBar, Input, PageHeader, Select, Skeleton,
} from "@/components/ui/index";
import { CreateDialog, DetailDialog, RenewDialog } from "./obligations-dialogs";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; obligations: Obligation[]; types: ObligationType[]; counts: Counts; today: string };

type Counts = { all: number; expired: number; expiring: number; valid: number; no_expiry: number };
export type WorkerOption = { id: string; firstName: string; lastName: string; isActive: boolean };
export type MachineOption = { id: string; code: string; name: string; isActive: boolean };

export const STATE_LABEL: Record<ObligationStateName, string> = {
  valid: "Važeće",
  expiring: "Uskoro istječe",
  expired: "Isteklo",
  superseded: "Zamijenjeno",
  no_expiry: "Bez roka",
};

const STATE_TONE: Record<ObligationStateName, "full" | "hot" | "hollow"> = {
  valid: "full",
  expiring: "hot",
  expired: "hot",
  superseded: "hollow",
  no_expiry: "hollow",
};

/** Rok u riječima: „za 5 dana“, „istječe danas“, „prije 3 dana“ — bez računanja u glavi. */
export function daysLabel(obligation: Obligation): string {
  if (obligation.daysLeft === null) return "bez roka";
  if (obligation.daysLeft === 0) return "istječe danas";
  if (obligation.daysLeft === 1) return "za 1 dan";
  if (obligation.daysLeft > 1) return `za ${obligation.daysLeft} dana`;
  const ago = Math.abs(obligation.daysLeft);
  return ago === 1 ? "prije 1 dan" : `prije ${ago} dana`;
}

export const targetLabel = (obligation: Obligation): string => {
  if (obligation.workerName) return obligation.workerName;
  if (obligation.machineCode) return `${obligation.machineCode} · ${obligation.machineName ?? ""}`.trim();
  return "Cijela firma";
};

export default function ObligationsClient({ canManage }: { canManage: boolean }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [stateFilter, setStateFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [creating, setCreating] = useState<{ returnTo: HTMLElement | null } | null>(null);
  const [renewing, setRenewing] = useState<{ obligation: Obligation; returnTo: HTMLElement | null } | null>(null);
  const [detail, setDetail] = useState<{ obligation: Obligation; returnTo: HTMLElement | null } | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const [obligations, types] = await Promise.all([
      apiCall<{ obligations: Obligation[]; counts: Counts; today: string }>("/api/obligations"),
      apiCall<{ types: ObligationType[] }>("/api/obligation-types"),
    ]);
    if (!obligations.ok) {
      setState({ kind: "error", message: obligations.message });
      return;
    }
    if (!types.ok) {
      setState({ kind: "error", message: types.message });
      return;
    }
    setState({
      kind: "ready",
      obligations: obligations.data.obligations,
      counts: obligations.data.counts,
      today: obligations.data.today,
      types: types.data.types,
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const obligations = state.kind === "ready" ? state.obligations : [];
  const types = state.kind === "ready" ? state.types : [];

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return obligations.filter((row) => {
      if (stateFilter && row.state !== stateFilter) return false;
      if (typeFilter && row.typeId !== typeFilter) return false;
      if (needle.length === 0) return true;
      return `${row.typeLabel} ${targetLabel(row)} ${row.number ?? ""} ${row.issuer ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [obligations, stateFilter, typeFilter, filter]);

  return (
    <div>
      <PageHeader
        title="Rokovi"
        subtitle={`Ljekarski, registracije, osiguranja i ostalo — stanje se računa po danu u zoni firme${state.kind === "ready" ? ` (danas je ${formatDate(state.today)})` : ""}.`}
        actions={canManage ? (
          <Button
            variant="primary"
            icon="list"
            onClick={(event) => setCreating({ returnTo: event.currentTarget })}
          >
            + Nova obaveza
          </Button>
        ) : null}
      />

      {message ? (
        <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </Alert>
      ) : null}

      <Card>
        {state.kind === "ready" ? (
          <FilterBar>
            <Select label="Stanje"id="obligation-state"
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
              >
                <option value="">Sva stanja ({state.counts.all})</option>
                <option value="expired">Isteklo ({state.counts.expired})</option>
                <option value="expiring">Uskoro istječe ({state.counts.expiring})</option>
                <option value="valid">Važeće ({state.counts.valid})</option>
                <option value="no_expiry">Bez roka ({state.counts.no_expiry})</option>
              </Select>
            <Select label="Tip obaveze"id="obligation-type"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
              >
                <option value="">Svi tipovi</option>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </Select>
            <Input label="Traži"id="obligation-filter"
                placeholder="Osoba, mašina, broj"
                value={filter}
                onChange={(event) => setFilter(event.target.value)} />
          </FilterBar>
        ) : null}

        {state.kind === "loading" ? <Skeleton rows={5} /> : null}

        {state.kind === "error" ? (
          <div className="gx-stack">
            <Alert tone="error" role="alert">
              {state.message}
            </Alert>
            <div>
              <Button onClick={() => void load()}>Pokušaj ponovo</Button>
            </div>
          </div>
        ) : null}

        {state.kind === "ready" && obligations.length === 0 ? (
          <EmptyState
            title="Još nema obaveza"
            description="Dodajte prvu obavezu — ljekarski radnika, registraciju vozila ili licencu firme."
            action={
              canManage ? (
                <Button variant="primary" onClick={(event) => setCreating({ returnTo: event.currentTarget })}>
                  + Nova obaveza
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {state.kind === "ready" && obligations.length > 0 && visible.length === 0 ? (
          <EmptyState
            title="Nema obaveza koje odgovaraju filteru"
            description="Promijenite stanje ili tip."
            action={
              <Button
                onClick={() => {
                  setStateFilter("");
                  setTypeFilter("");
                  setFilter("");
                }}
              >
                Obriši filter
              </Button>
            }
          />
        ) : null}

        {visible.length > 0 ? (
          <DataTable
            caption="Obaveze i rokovi"
            rows={visible}
            rowKey={(obligation) => obligation.id}
            emptyText="Nema obaveza koje odgovaraju filteru."
            columns={[
              {
                key: "obligation",
                header: "Obaveza",
                cell: (obligation) => (
                  <span className="gx-who">
                    {obligation.typeLabel}
                    <span>
                      {obligation.issuer ?? "—"}
                      {obligation.number ? ` · br. ${obligation.number}` : ""}
                      {obligation.currentVersion > 1 ? ` · v${obligation.currentVersion}` : ""}
                    </span>
                  </span>
                ),
              },
              { key: "target", header: "Na koga / na šta", cell: (obligation) => targetLabel(obligation) },
              {
                key: "expires",
                header: "Rok",
                cell: (obligation) => (
                  <span className="gx-stack gx-stack--2">
                    <span className="gx-mono">{formatDate(obligation.expiresAt)}</span>
                    <span className="gx-page-sub">{daysLabel(obligation)}</span>
                  </span>
                ),
              },
              { key: "state", header: "Stanje", cell: (obligation) => <Chip tone={STATE_TONE[obligation.state]}>{STATE_LABEL[obligation.state]}</Chip> },
            ]}
            rowActionLabel={(obligation) => `Više radnji za ${obligation.typeLabel}`}
            actions={(obligation) => [
              { key: "detail", label: "Detalj", onSelect: (returnTo) => setDetail({ obligation, returnTo: returnTo ?? null }) },
              ...(canManage
                ? [{ key: "renew", label: "Obnovi", onSelect: (returnTo: HTMLElement | null | undefined) => setRenewing({ obligation, returnTo: returnTo ?? null }) }]
                : []),
            ]}
          />
        ) : null}
      </Card>

      {creating ? (
        <CreateDialog
          types={types}
          returnFocusTo={creating.returnTo}
          onSaved={async (text) => {
            setCreating(null);
            setMessage({ tone: "success", text });
            await load();
          }}
          onClose={() => setCreating(null)}
        />
      ) : null}

      {renewing ? (
        <RenewDialog
          obligation={renewing.obligation}
          returnFocusTo={renewing.returnTo}
          onSaved={async (text) => {
            setRenewing(null);
            setMessage({ tone: "success", text });
            await load();
          }}
          onClose={() => setRenewing(null)}
        />
      ) : null}

      {detail ? (
        <DetailDialog
          obligation={detail.obligation}
          canManage={canManage}
          returnFocusTo={detail.returnTo}
          onChanged={async (text) => {
            setMessage({ tone: "success", text });
            await load();
          }}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Nova obaveza. Tip određuje na šta se obaveza veže (radnik / mašina / firma) — polja se
 * mijenjaju sa tipom, pa se ne može napraviti ljekarski na mašini.
 */

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
import { apiCall, jsonBody } from "@/api-client";
import { formatDate } from "@/format";
import { Dialog } from "@/components/dialog";
import {
  Alert,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Mono,
  SectionTitle,
  Skeleton,
  inputClass,
} from "@/components/ui";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; obligations: Obligation[]; types: ObligationType[]; counts: Counts; today: string };

type Counts = { all: number; expired: number; expiring: number; valid: number; no_expiry: number };
type WorkerOption = { id: string; firstName: string; lastName: string; isActive: boolean };
type MachineOption = { id: string; code: string; name: string; isActive: boolean };

const STATE_LABEL: Record<ObligationStateName, string> = {
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
function daysLabel(obligation: Obligation): string {
  if (obligation.daysLeft === null) return "bez roka";
  if (obligation.daysLeft === 0) return "istječe danas";
  if (obligation.daysLeft === 1) return "za 1 dan";
  if (obligation.daysLeft > 1) return `za ${obligation.daysLeft} dana`;
  const ago = Math.abs(obligation.daysLeft);
  return ago === 1 ? "prije 1 dan" : `prije ${ago} dana`;
}

const targetLabel = (obligation: Obligation): string => {
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
      <div className="gx-page-head">
        <div className="gx-page-head__text">
          <h1 className="gx-page-title">Rokovi</h1>
          <p className="gx-page-sub">
            Ljekarski, registracije, osiguranja i ostalo — stanje se računa po danu u zoni firme
            {state.kind === "ready" ? ` (danas je ${formatDate(state.today)})` : ""}.
          </p>
        </div>
        {canManage ? (
          <div className="gx-page-head__actions">
            <Button
              variant="primary"
              icon="list"
              onClick={(event) => setCreating({ returnTo: event.currentTarget })}
            >
              + Nova obaveza
            </Button>
          </div>
        ) : null}
      </div>

      {message ? (
        <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </Alert>
      ) : null}

      <Card>
        {state.kind === "ready" ? (
          <div className="gx-filters" style={{ marginBottom: "var(--space-5)" }}>
            <Field label="Stanje" htmlFor="obligation-state">
              <select
                id="obligation-state"
                className={inputClass}
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
              >
                <option value="">Sva stanja ({state.counts.all})</option>
                <option value="expired">Isteklo ({state.counts.expired})</option>
                <option value="expiring">Uskoro istječe ({state.counts.expiring})</option>
                <option value="valid">Važeće ({state.counts.valid})</option>
                <option value="no_expiry">Bez roka ({state.counts.no_expiry})</option>
              </select>
            </Field>
            <Field label="Tip obaveze" htmlFor="obligation-type">
              <select
                id="obligation-type"
                className={inputClass}
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
              >
                <option value="">Svi tipovi</option>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Traži" htmlFor="obligation-filter">
              <input
                id="obligation-filter"
                className={inputClass}
                placeholder="Osoba, mašina, broj"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {state.kind === "loading" ? <Skeleton rows={5} /> : null}

        {state.kind === "error" ? (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
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
          <table className="gx-table gx-table--cards">
            <thead>
              <tr>
                <th>Obaveza</th>
                <th>Na koga / na šta</th>
                <th>Rok</th>
                <th>Stanje</th>
                <th style={{ textAlign: "right" }}>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((obligation) => (
                <tr key={obligation.id}>
                  <td data-label="Obaveza">
                    <div className="gx-who" style={{ fontWeight: 600 }}>
                      {obligation.typeLabel}
                      <span>
                        {obligation.issuer ?? "—"}
                        {obligation.number ? ` · br. ${obligation.number}` : ""}
                        {obligation.currentVersion > 1 ? ` · v${obligation.currentVersion}` : ""}
                      </span>
                    </div>
                  </td>
                  <td data-label="Na koga / na šta">{targetLabel(obligation)}</td>
                  <td data-label="Rok" style={{ whiteSpace: "nowrap" }}>
                    <div style={{ display: "grid", gap: 2 }}>
                      <span className="gx-mono">{formatDate(obligation.expiresAt)}</span>
                      <span style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
                        {daysLabel(obligation)}
                      </span>
                    </div>
                  </td>
                  <td data-label="Stanje">
                    <Chip tone={STATE_TONE[obligation.state]}>{STATE_LABEL[obligation.state]}</Chip>
                  </td>
                  <td data-label="Akcija">
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <Button
                        variant="secondary"
                        onClick={(event) => setDetail({ obligation, returnTo: event.currentTarget })}
                      >
                        Detalj
                      </Button>
                      {canManage ? (
                        <Button
                          variant="primary"
                          className="whitespace-nowrap"
                          onClick={(event) => setRenewing({ obligation, returnTo: event.currentTarget })}
                        >
                          Obnovi
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
function CreateDialog({
  types,
  returnFocusTo,
  onSaved,
  onClose,
}: {
  types: ObligationType[];
  returnFocusTo: HTMLElement | null;
  onSaved: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [typeId, setTypeId] = useState(types.find((type) => type.entityKind === "WORKER")?.id ?? types[0]?.id ?? "");
  const selected = types.find((type) => type.id === typeId) ?? null;
  const [workerId, setWorkerId] = useState("");
  const [machineId, setMachineId] = useState("");
  // R3: obaveza na projektu (dozvola, saglasnost, HSE elaborat).
  const [projectId, setProjectId] = useState("");
  const [number, setNumber] = useState("");
  const [issuer, setIssuer] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [workers, setWorkers] = useState<WorkerOption[] | null>(null);
  const [machines, setMachines] = useState<MachineOption[] | null>(null);
  const [projects, setProjects] = useState<{ id: string; code: string; name: string }[] | null>(null);

  const kind = selected?.entityKind ?? "WORKER";

  // Liste se traže tek kad su potrebne — ekran rokova ne čeka na radnike i mašine.
  useEffect(() => {
    if (kind === "WORKER" && workers === null) {
      void (async () => {
        const result = await apiCall<{ workers: WorkerOption[] }>("/api/workers");
        if (result.ok) setWorkers(result.data.workers);
      })();
    }
    if (kind === "MACHINE" && machines === null) {
      void (async () => {
        const result = await apiCall<{ machines: MachineOption[] }>("/api/equipment");
        if (result.ok) setMachines(result.data.machines);
      })();
    }
    if (kind === "PROJECT" && projects === null) {
      void (async () => {
        const result = await apiCall<{ projects: { id: string; code: string; name: string }[] }>("/api/projects");
        if (result.ok) setProjects(result.data.projects);
      })();
    }
  }, [kind, workers, machines, projects]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await apiCall<{ obligation: Obligation }>(
        "/api/obligations",
        jsonBody({
          typeId,
          workerId: kind === "WORKER" ? workerId : null,
          machineId: kind === "MACHINE" ? machineId : null,
          projectId: kind === "PROJECT" ? projectId : null,
          scopeCompany: kind === "COMPANY",
          number: number.trim() || null,
          issuer: issuer.trim() || null,
          issuedAt: issuedAt || null,
          expiresAt: expiresAt || null,
        }),
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onSaved(`${selected?.label ?? "Obaveza"} je dodana.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Nova obaveza"
      hint="Tip određuje na šta se obaveza veže i koji su pragovi podsjetnika."
      returnFocusTo={returnFocusTo}
      onClose={onClose}
      wide
    >
      <form onSubmit={save} style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-5)" }}>
        {error ? (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        ) : null}

        <Field
          label="Tip obaveze"
          htmlFor="new-type"
          hint={
            selected
              ? selected.defaultReminderDays.length > 0
                ? `Podsjetnik ${selected.defaultReminderDays.join("/")} dana prije roka.`
                : "Tip bez podsjetnika — vidi se samo kad istekne."
              : undefined
          }
        >
          <select id="new-type" className={inputClass} value={typeId} onChange={(event) => setTypeId(event.target.value)}>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </Field>

        {kind === "WORKER" ? (
          <Field label="Radnik" htmlFor="new-worker">
            <select
              id="new-worker"
              className={inputClass}
              value={workerId}
              onChange={(event) => setWorkerId(event.target.value)}
              required
            >
              <option value="">— izaberite —</option>
              {(workers ?? []).filter((worker) => worker.isActive).map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.firstName} {worker.lastName}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {kind === "MACHINE" ? (
          <Field label="Mašina ili vozilo" htmlFor="new-machine">
            <select
              id="new-machine"
              className={inputClass}
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
              required
            >
              <option value="">— izaberite —</option>
              {(machines ?? []).filter((machine) => machine.isActive).map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.code} · {machine.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {kind === "PROJECT" ? (
          <Field label="Projekat" htmlFor="new-project">
            <select
              id="new-project"
              className={inputClass}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              required
            >
              <option value="">— izaberite —</option>
              {(projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} · {project.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {kind === "COMPANY" ? (
          <Alert tone="info">Ova obaveza se odnosi na cijelu firmu.</Alert>
        ) : null}

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Broj dokumenta" htmlFor="new-number">
            <input id="new-number" className={inputClass} value={number} onChange={(event) => setNumber(event.target.value)} maxLength={120} />
          </Field>
          <Field label="Izdavalac" htmlFor="new-issuer">
            <input id="new-issuer" className={inputClass} value={issuer} onChange={(event) => setIssuer(event.target.value)} maxLength={200} />
          </Field>
        </div>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Datum izdavanja" htmlFor="new-issued">
            <input
              id="new-issued"
              className={inputClass}
              type="date"
              value={issuedAt}
              onChange={(event) => setIssuedAt(event.target.value)}
            />
          </Field>
          <Field label="Rok važenja" htmlFor="new-expires" hint="Ostavite prazno samo kad obaveza nema rok (garancija).">
            <input
              id="new-expires"
              className={inputClass}
              type="date"
              value={expiresAt}
              min={issuedAt || undefined}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </Field>
        </div>

        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Otkaži
          </Button>
          <Button type="submit" variant="primary" fullWidthOnMobile disabled={saving || !typeId}>
            {saving ? "Čuvam…" : "Dodaj obavezu"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Obnova: nova verzija. Stara ostaje — to i piše u dijalogu, da niko ne pomisli da je izgubljena. */
function RenewDialog({
  obligation,
  returnFocusTo,
  onSaved,
  onClose,
}: {
  obligation: Obligation;
  returnFocusTo: HTMLElement | null;
  onSaved: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [number, setNumber] = useState("");
  const [issuer, setIssuer] = useState(obligation.issuer ?? "");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await apiCall<{ obligation: Obligation }>(
        `/api/obligations/${obligation.id}/renew`,
        jsonBody({
          number: number.trim() || null,
          issuer: issuer.trim() || null,
          issuedAt: issuedAt || null,
          expiresAt,
        }),
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onSaved(`${obligation.typeLabel} je obnovljena — verzija ${result.data.obligation.currentVersion}. Stara ostaje u historiji.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={`Obnova · ${obligation.typeLabel}`}
      hint={`${targetLabel(obligation)} · trenutni rok ${formatDate(obligation.expiresAt)} · verzija ${obligation.currentVersion}`}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
    >
      <form onSubmit={save} style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-5)" }}>
        {error ? (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        ) : null}

        <Field label="Novi rok" htmlFor="renew-expires" hint="Mora biti poslije trenutnog roka.">
          <input
            id="renew-expires"
            className={inputClass}
            type="date"
            value={expiresAt}
            min={obligation.expiresAt ?? undefined}
            onChange={(event) => setExpiresAt(event.target.value)}
            required
          />
        </Field>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Novi broj dokumenta" htmlFor="renew-number">
            <input id="renew-number" className={inputClass} value={number} onChange={(event) => setNumber(event.target.value)} maxLength={120} />
          </Field>
          <Field label="Izdavalac" htmlFor="renew-issuer">
            <input id="renew-issuer" className={inputClass} value={issuer} onChange={(event) => setIssuer(event.target.value)} maxLength={200} />
          </Field>
        </div>

        <Field label="Datum izdavanja novog dokumenta" htmlFor="renew-issued">
          <input
            id="renew-issued"
            className={inputClass}
            type="date"
            value={issuedAt}
            onChange={(event) => setIssuedAt(event.target.value)}
          />
        </Field>

        <p style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
          Stara verzija ostaje u historiji sa svojim rokom — ne prepisuje se.
        </p>

        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Otkaži
          </Button>
          <Button type="submit" variant="primary" fullWidthOnMobile disabled={saving || !expiresAt}>
            {saving ? "Obnavljam…" : "Obnovi"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Detalj: verzije i prilozi. Prilog se dodaje iz detalja jer tu ima smisla. */
function DetailDialog({
  obligation,
  canManage,
  returnFocusTo,
  onChanged,
  onClose,
}: {
  obligation: Obligation;
  canManage: boolean;
  returnFocusTo: HTMLElement | null;
  onChanged: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<
    { version: number; expiresAt: string | null; number: string | null; issuer: string | null; createdAt: string }[] | null
  >(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await apiCall<{
        versions: { version: number; expiresAt: string | null; number: string | null; issuer: string | null; createdAt: string }[];
      }>(`/api/obligations/${obligation.id}`);
      if (result.ok) setVersions(result.data.versions);
    })();
  }, [obligation.id]);

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      // `sha256` i prvih 32 bajta: server po sadržaju odlučuje da li je PDF ili slika.
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const sha256 = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const head = Array.from(buffer.slice(0, 32));

      const registered = await apiCall<{ attachment: { id: string }; uploadUrl: string }>(
        `/api/obligations/${obligation.id}/attachments`,
        jsonBody({
          fileName: file.name,
          sizeBytes: file.size,
          sha256,
          headBase64: btoa(String.fromCharCode(...head)),
        }),
      );
      if (!registered.ok) {
        setMessage({ tone: "error", text: registered.message });
        return;
      }

      const put = await fetch(registered.data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: buffer,
      });
      if (!put.ok) {
        setMessage({ tone: "error", text: "Upload nije prošao. Pokušajte ponovo." });
        return;
      }

      const confirmed = await apiCall<{ attachment: { status: string } }>(
        `/api/obligations/${obligation.id}/attachments/${registered.data.attachment.id}/confirm`,
        { method: "POST" },
      );
      if (!confirmed.ok) {
        setMessage({ tone: "error", text: confirmed.message });
        return;
      }
      setMessage({ tone: "success", text: "Prilog je dodan." });
      await onChanged("Prilog je dodan uz obavezu.");
    } catch {
      setMessage({ tone: "error", text: "Upload nije prošao. Provjerite vezu i pokušajte ponovo." });
    } finally {
      setBusy(false);
    }
  }

  async function open(attachmentId: string) {
    const result = await apiCall<{ url: string }>(
      `/api/obligations/${obligation.id}/attachments/${attachmentId}/url`,
    );
    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog
      title={obligation.typeLabel}
      hint={`${targetLabel(obligation)} · rok ${formatDate(obligation.expiresAt)} · ${STATE_LABEL[obligation.state]}`}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
      wide
    >
      <div style={{ marginTop: "var(--space-5)", display: "grid", gap: "var(--space-5)" }}>
        {message ? (
          <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
            {message.text}
          </Alert>
        ) : null}

        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px var(--space-4)", fontSize: "var(--text-body)" }}>
          <dt style={{ color: "var(--muted)" }}>Izdavalac</dt>
          <dd>{obligation.issuer ?? "—"}</dd>
          <dt style={{ color: "var(--muted)" }}>Broj</dt>
          <dd>
            <Mono>{obligation.number ?? "—"}</Mono>
          </dd>
          <dt style={{ color: "var(--muted)" }}>Izdato</dt>
          <dd className="gx-mono">{formatDate(obligation.issuedAt)}</dd>
          <dt style={{ color: "var(--muted)" }}>Rok</dt>
          <dd className="gx-mono">
            {formatDate(obligation.expiresAt)} ({daysLabel(obligation)})
          </dd>
          <dt style={{ color: "var(--muted)" }}>Odgovoran</dt>
          <dd>{obligation.responsibleName ?? "—"}</dd>
          <dt style={{ color: "var(--muted)" }}>Podsjetnici</dt>
          <dd>
            {obligation.reminderDays.length > 0
              ? `${obligation.reminderDays.join(" / ")} dana prije roka`
              : "nema"}
          </dd>
        </dl>

        <section>
          <SectionTitle hint="Stara verzija ostaje — istorija je dokaz.">Verzije</SectionTitle>
          {versions === null ? (
            <Skeleton rows={2} />
          ) : (
            <table className="gx-table gx-table--cards">
              <thead>
                <tr>
                  <th>Verzija</th>
                  <th>Rok</th>
                  <th>Broj</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((entry) => (
                  <tr key={entry.version}>
                    <td data-label="Verzija">
                      <Mono>v{entry.version}</Mono>
                    </td>
                    <td data-label="Rok">{formatDate(entry.expiresAt)}</td>
                    <td data-label="Broj">{entry.number ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <SectionTitle hint="PDF ili slika, do 10 MB. Tip se provjerava po sadržaju.">Prilozi</SectionTitle>
          {obligation.attachments.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: "var(--text-small)" }}>Još nema priloga.</p>
          ) : (
            <ul style={{ display: "grid", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
              {obligation.attachments.map((attachment) => (
                <li key={attachment.id} style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 140 }}>{attachment.fileName}</span>
                  <span style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
                    {(attachment.sizeBytes / 1024).toFixed(0)} kB
                  </span>
                  <Button onClick={() => void open(attachment.id)}>Otvori</Button>
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <div style={{ marginTop: "var(--space-3)" }}>
              <Field label="Dodaj prilog" htmlFor="attachment-file">
                <input
                  id="attachment-file"
                  className={inputClass}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
              </Field>
            </div>
          ) : null}
        </section>

        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose}>
            Zatvori
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

"use client";

/**
 * R4a-2 ekran ureda (odobren dizajn): lista = DataTable, detalj = dva
 * DescriptionList, odluke = ConfirmDialog s obaveznim razlogom koji vidi
 * autor odbačenog unosa. Interna napomena se upisuje ovdje i ostaje u uredu.
 * „Već razriješeno" se prikazuje iz odgovora servera (ko/kada/šta), akcije se gase.
 */
import { useCallback, useMemo, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Card, Chip, ConfirmDialog, DataTable, DescriptionList,
  EmptyState, FilterBar, FormGrid, Inline, Input, Mono, SectionTitle, Select,
  Stack, Stat, Textarea,
} from "@/components/ui/index";
import { formatDate, formatDateTime } from "@/format";
import type {
  ResolveConflictResponse, WorkdayConflict, WorkdayConflictCountsResponse,
  WorkdayConflictDetail, WorkdayConflictsResponse,
} from "@gradix/contracts";

type Counts = WorkdayConflictCountsResponse;

const KIND_LABEL: Record<string, string> = {
  ACCEPT_SERVER: "prihvaćen unos sa servera",
  ACCEPT_RECEIVED: "prihvaćen unos s telefona",
  CORRECTED_TIMES: "ispravljena vremena",
  REJECTED: "svi unosi odbačeni",
};

function hhmm(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Sarajevo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function timesLabel(times: WorkdayConflict["serverTimes"]): string {
  if (!times) return "—";
  return times.endState === "KNOWN_END" && times.endedAt
    ? `${hhmm(times.startedAt)}–${hhmm(times.endedAt)}`
    : `${hhmm(times.startedAt)}–${times.endState === "OPEN" ? "otvoren" : "nepoznat kraj"}`;
}

/** Pomjeri trenutak tako da mu sarajevsko vrijeme bude `target` (HH:MM); datum/offset se čuvaju. */
function shiftToHhmm(iso: string, target: string): string | null {
  const [h, m] = target.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m) || h > 23 || m > 59) return null;
  const current = hhmm(iso).split(":").map(Number);
  const diff = (h * 60 + m) - ((current[0] ?? 0) * 60 + (current[1] ?? 0));
  return new Date(Date.parse(iso) + diff * 60_000).toISOString();
}

export function ConflictsClient({ initial, counts }: { initial: WorkdayConflict[]; counts: Counts }) {
  const [rows, setRows] = useState<WorkdayConflict[]>(initial);
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "RESOLVED">("OPEN");
  const [onlyOld, setOnlyOld] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [detail, setDetail] = useState<WorkdayConflictDetail | null>(null);
  const [countsState, setCountsState] = useState<Counts>(counts);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const [acceptTarget, setAcceptTarget] = useState<"SERVER" | "RECEIVED" | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [corrStart, setCorrStart] = useState("");
  const [corrEnd, setCorrEnd] = useState("");
  const [corrTarget, setCorrTarget] = useState<"SERVER" | "RECEIVED">("SERVER");
  const [corrOpen, setCorrOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      const id = row.receivedTimes ? (detail?.received?.projectId ?? null) : null;
      void id;
      if (row.projectId) map.set(row.projectId, `${row.projectCode ?? ""} · ${row.projectName ?? ""}`);
    }
    return [...map.entries()];
  }, [rows, detail]);

  const refresh = useCallback(async (status: "OPEN" | "RESOLVED", old: boolean, project: string) => {
    const query = new URLSearchParams({ status, limit: "50" });
    if (old) query.set("olderThanDays", "0");
    if (project) query.set("projectId", project);
    const list = await apiCall<WorkdayConflictsResponse>(`/api/workday-conflicts?${query.toString()}`);
    if (list.ok) setRows(list.data.conflicts);
    const fresh = await apiCall<Counts>("/api/workday-conflicts/counts");
    if (fresh.ok) setCountsState(fresh.data);
  }, []);

  const openDetail = useCallback(async (id: string) => {
    const res = await apiCall<{ conflict: WorkdayConflictDetail }>(`/api/workday-conflicts/${id}`);
    if (!res.ok) {
      setNotice({ tone: "error", text: res.message });
      return;
    }
    const conflict = res.data.conflict;
    setDetail(conflict);
    setInternalNote(conflict.internalNote ?? "");
    const base = conflict.server?.times ?? conflict.received?.times;
    setCorrStart(base ? hhmm(base.startedAt) : "");
    setCorrEnd(base?.endedAt ? hhmm(base.endedAt) : "");
    setCorrTarget(conflict.server ? "SERVER" : "RECEIVED");
    setNotice(null);
  }, []);

  const applyOutcome = useCallback((result: ResolveConflictResponse) => {
    if (result.outcome === "RESOLVED") {
      setNotice({ tone: "success", text: "Sukob je razriješen. Ishod i razlog autor unosa vidi pri sljedećoj sinhronizaciji." });
    } else if (result.outcome === "ALREADY_RESOLVED") {
      setNotice({
        tone: "warning",
        text: `Već razriješeno${result.resolvedAt ? ` ${formatDateTime(result.resolvedAt)}` : ""}${result.kind ? ` — ${KIND_LABEL[result.kind] ?? result.kind}` : ""}. Vaša odluka nije primijenjena.`,
      });
    } else if (result.outcome === "VALIDATION_FAILED") {
      setNotice({
        tone: "error",
        text: result.code === "WORK_ENTRY_OVERLAP"
          ? "Ispravljena vremena se preklapaju s drugim segmentom radnika. Promijenite vremena i pokušajte ponovo — ništa nije sačuvano."
          : "Server je odbio odluku (provjerite razlog i vremena). Ništa nije sačuvano.",
      });
    } else {
      setNotice({ tone: "error", text: "Nemate pravo razriješiti ovaj sukob (opseg ili strana u sukobu)." });
    }
  }, []);

  const resolve = useCallback(async (kind: "ACCEPT_SERVER" | "ACCEPT_RECEIVED" | "CORRECTED_TIMES" | "REJECTED") => {
    if (!detail) return;
    setBusy(true);
    const body: Record<string, unknown> = {
      kind,
      reason,
      internalNote: internalNote.trim() ? internalNote.trim() : null,
      idempotencyKey: `${detail.id}-${kind}-${Date.now()}`,
    };
    if (kind === "CORRECTED_TIMES") {
      const base = corrTarget === "SERVER" ? detail.server?.times : detail.received?.times;
      if (!base) { setBusy(false); return; }
      const startedAt = shiftToHhmm(base.startedAt, corrStart);
      const endedAt = base.endedAt ? shiftToHhmm(base.endedAt, corrEnd) : null;
      if (!startedAt || (base.endState === "KNOWN_END" && !endedAt)) {
        setBusy(false);
        setNotice({ tone: "error", text: "Vremena moraju biti u obliku HH:MM (24 h)." });
        return;
      }
      body.correctedTimes = { startedAt, endedAt, endState: base.endState };
      body.correctedTarget = corrTarget;
    }
    const res = await apiCall<ResolveConflictResponse>(`/api/workday-conflicts/${detail.id}/resolve`, jsonBody(body));
    setBusy(false);
    setAcceptTarget(null);
    setRejectOpen(false);
    if (!res.ok) {
      setNotice({ tone: "error", text: res.message });
      return;
    }
    applyOutcome(res.data);
    await refresh(statusFilter, onlyOld, projectFilter);
    await openDetail(detail.id);
  }, [detail, reason, internalNote, corrStart, corrEnd, corrTarget, applyOutcome, refresh, statusFilter, onlyOld, projectFilter, openDetail]);

  const resolved = detail?.status === "RESOLVED";

  return (
    <Stack>
      <Card>
        <Inline>
          <Stat label="Nerazriješeni sukobi" value={String(countsState.open)} />
          <Stat label={`Stariji od ${countsState.thresholdDays} dana`} value={String(countsState.olderThanThreshold)} />
          {countsState.olderThanThreshold > 0 ? (
            <Chip tone="hot">{countsState.olderThanThreshold} stariji od {countsState.thresholdDays} dana</Chip>
          ) : null}
        </Inline>
      </Card>

      <FilterBar>
        <Select
          label="Stanje"
          value={statusFilter}
          onChange={(event) => {
            const value = event.target.value as "OPEN" | "RESOLVED";
            setStatusFilter(value);
            void refresh(value, onlyOld, projectFilter);
          }}
        >
          <option value="OPEN">Nerazriješeni</option>
          <option value="RESOLVED">Razriješeni</option>
        </Select>
        <Select
          label="Starost"
          value={onlyOld ? "old" : "all"}
          onChange={(event) => {
            const value = event.target.value === "old";
            setOnlyOld(value);
            void refresh(statusFilter, value, projectFilter);
          }}
        >
          <option value="all">Svi</option>
          <option value="old">Stariji od praga ({countsState.thresholdDays} d.)</option>
        </Select>
        <Select
          label="Projekat"
          value={projectFilter}
          onChange={(event) => {
            setProjectFilter(event.target.value);
            void refresh(statusFilter, onlyOld, event.target.value);
          }}
        >
          <option value="">Svi projekti</option>
          {projects.map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        caption="Sukobi radnih dana"
        rows={rows}
        rowKey={(row) => row.id}
        emptyText="Nema sukoba za izabrane filtere."
        columns={[
          { key: "worker", header: "Radnik", cell: (row) => row.workerName ?? "—" },
          { key: "project", header: "Projekat", cell: (row) => (row.projectCode ? `${row.projectCode} · ${row.projectName ?? ""}` : "—") },
          { key: "date", header: "Datum", cell: (row) => (row.workDate ? formatDate(row.workDate) : "—") },
          {
            key: "times", header: "Server / telefon", cell: (row) => (
              <Mono>{timesLabel(row.serverTimes)} / {timesLabel(row.receivedTimes)}</Mono>
            ),
          },
          {
            key: "since", header: "Čeka", cell: (row) => (
              row.status === "RESOLVED"
                ? <Chip tone="full">Razriješeno</Chip>
                : row.ageDays >= countsState.thresholdDays
                  ? <Chip tone="hot">prije {row.ageDays} d.</Chip>
                  : <span>prije {row.ageDays} d.</span>
            ),
          },
          {
            key: "open", header: "", cell: (row) => (
              <Button onClick={() => void openDetail(row.id)}>Otvori</Button>
            ),
          },
        ]}
      />

      {notice ? <Alert tone={notice.tone === "success" ? "success" : notice.tone === "warning" ? "warning" : "error"}>{notice.text}</Alert> : null}

      {detail ? (
        <Stack>
          <Alert tone="warning">
            Preklopljeni interval postoji u oba unosa — ured bira jedan, vremena se ne spajaju automatski.
          </Alert>
          <FormGrid>
            <Card>
              <SectionTitle hint="Ono što ured već ima (server).">Unos sa servera</SectionTitle>
              <DescriptionList
                items={[
                  { term: "Autor", value: detail.server?.authorName ? `${detail.server.authorName} · izvor: server` : "—" },
                  { term: "Primljeno", value: detail.server?.receivedAt ? formatDateTime(detail.server.receivedAt) : "—" },
                  { term: "Početak–kraj", value: <Mono>{timesLabel(detail.server?.times ?? null)}</Mono> },
                  { term: "Projekat", value: detail.projectCode ? `${detail.projectCode} · ${detail.projectName ?? ""}` : "—" },
                  { term: "Mašina", value: detail.server?.machineLabel ?? "—" },
                ]}
              />
              <Inline>
                <Button variant="primary" disabled={resolved || busy} onClick={() => { setReason(""); setAcceptTarget("SERVER"); }}>
                  Prihvati ovaj unos
                </Button>
              </Inline>
            </Card>
            <Card>
              <SectionTitle hint="Ono što je telefon poslao naknadno.">Unos s telefona</SectionTitle>
              <DescriptionList
                items={[
                  { term: "Autor", value: detail.received?.authorName ? `${detail.received.authorName} · izvor: telefon` : "—" },
                  { term: "Primljeno", value: detail.received ? formatDateTime(detail.received.receivedAt) : "—" },
                  { term: "Početak–kraj", value: <Mono>{timesLabel(detail.received?.times ?? null)}</Mono> },
                  { term: "Projekat", value: detail.projectCode ? `${detail.projectCode} · ${detail.projectName ?? ""}` : "—" },
                ]}
              />
              <Inline>
                {detail.clockSkewMinutes !== null ? (
                  <Chip tone="hollow">Sat telefona odstupa{detail.clockSkewMinutes ? ` +${detail.clockSkewMinutes} min` : ""}</Chip>
                ) : null}
                <Button variant="primary" disabled={resolved || busy} onClick={() => { setReason(""); setAcceptTarget("RECEIVED"); }}>
                  Prihvati ovaj unos
                </Button>
              </Inline>
            </Card>
          </FormGrid>

          {resolved ? (
            <Card>
              <Inline>
                <Chip tone="full">Razriješeno</Chip>
                <span>
                  Razriješio/la {detail.resolvedByName ?? "—"}
                  {detail.resolvedAt ? ` · ${formatDateTime(detail.resolvedAt)}` : ""}
                  {detail.resolutionKind ? ` · ${KIND_LABEL[detail.resolutionKind] ?? detail.resolutionKind}` : ""}
                  {detail.resolvedByParty ? " · razriješila strana u sukobu (vlasnik)" : ""}
                  . Ovaj ekran više ne može mijenjati odluku.
                </span>
              </Inline>
              {detail.reason ? <p>Razlog: {detail.reason}</p> : null}
            </Card>
          ) : (
            <Card>
              <SectionTitle hint="Ispravka se primjenjuje na izabrani unos; original ostaje u auditu. Vrijeme je 24 h (HH:MM).">
                Ispravi vremena i dodatne odluke
              </SectionTitle>
              <FormGrid>
                <Select label="Unos koji se ispravlja" value={corrTarget} onChange={(event) => setCorrTarget(event.target.value as "SERVER" | "RECEIVED")}>
                  <option value="SERVER">Unos sa servera</option>
                  <option value="RECEIVED">Unos s telefona</option>
                </Select>
                <Input label="Početak (HH:MM, 24 h)" value={corrStart} onChange={(event) => setCorrStart(event.target.value)} placeholder="07:30" />
                <Input label="Kraj (HH:MM, 24 h)" value={corrEnd} onChange={(event) => setCorrEnd(event.target.value)} placeholder="15:30" />
              </FormGrid>
              <Stack>
                <Textarea
                  label="Interna napomena ureda (nikad se ne prikazuje radniku)"
                  hint="Vidi je samo ured. Ne ide na telefon ni u razlog koji radnik čita."
                  value={internalNote}
                  onChange={(event) => setInternalNote(event.target.value)}
                  maxLength={2000}
                />
                <Inline>
                  <Button disabled={busy} onClick={() => { setReason(""); setRejectOpen(true); }}>Odbaci uz razlog…</Button>
                  <Button disabled={busy} onClick={() => { setReason(""); setCorrOpen(true); }}>
                    Sačuvaj ispravljena vremena uz razlog…
                  </Button>
                </Inline>
                <p>Razlog za ispravku upisujete u dijalogu koji se otvara; vidi ga autor unosa čija se vremena mijenjaju.</p>
              </Stack>
            </Card>
          )}
        </Stack>
      ) : (
        <EmptyState title="Izaberite sukob" description="Otvorite sukob iz liste da vidite oba unosa i donesete odluku." />
      )}

      <ConfirmDialog
        open={acceptTarget !== null}
        title="Prihvati ovaj unos?"
        text="Drugi unos će biti odbačen i sačuvan u historiji, a njegov autor će vidjeti razlog koji upišete ispod. Razlog vidi radnik/šef čiji je unos odbačen — bez internih napomena ureda."
        confirmLabel="Prihvati ovaj unos"
        busy={busy}
        reason={{ value: reason, onChange: setReason, minLength: 10, label: "Razlog (vidi ga autor odbačenog unosa)", hint: "Obavezno, najmanje 10 znakova." }}
        onConfirm={() => void resolve(acceptTarget === "SERVER" ? "ACCEPT_SERVER" : "ACCEPT_RECEIVED")}
        onCancel={() => setAcceptTarget(null)}
      />
      <ConfirmDialog
        open={corrOpen}
        title="Sačuvati ispravljena vremena?"
        text="Ispravljena vremena postaju važeća za izabrani unos; original ostaje u auditu. Autor unosa vidi razlog i stara/nova vremena — bez internih napomena ureda."
        confirmLabel="Sačuvaj ispravku"
        busy={busy}
        reason={{ value: reason, onChange: setReason, minLength: 10, label: "Razlog ispravke (vidi ga autor unosa)", hint: "Obavezno, najmanje 10 znakova." }}
        onConfirm={() => { setCorrOpen(false); void resolve("CORRECTED_TIMES"); }}
        onCancel={() => setCorrOpen(false)}
      />
      <ConfirmDialog
        open={rejectOpen}
        title="Odbaci unose?"
        text="Unosi se čuvaju u historiji s razlogom i autorom odluke. Razlog vide autori na svojim telefonima — bez internih napomena ureda."
        confirmLabel="Odbaci uz razlog"
        danger
        busy={busy}
        reason={{ value: reason, onChange: setReason, minLength: 10, label: "Razlog odbacivanja (vidi ga i radnik)", hint: "Obavezno, najmanje 10 znakova. Jedna rečenica." }}
        onConfirm={() => void resolve("REJECTED")}
        onCancel={() => setRejectOpen(false)}
      />
    </Stack>
  );
}

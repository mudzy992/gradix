"use client";

/**
 * R4a-2/B: zasebna stranica jednog sukoba. Dva unosa jedan pored drugog na
 * širokom ekranu (FormGrid/gx-cols), jedan ispod drugog na uskom. Akcije su
 * uvijek na istom mjestu — ljepljiva traka pri dnu (gx-actionbar). Modal je
 * SAMO potvrda s obaveznim razlogom (≥10 znakova) koji vidi radnik; polje
 * interne napomene ostaje na stranici i nikad ne ide na uređaj. Kad je sukob
 * već razriješen, ista stranica pokazuje ko/kada/šta i akcije su ugašene.
 */
import { useCallback, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Card, Chip, ConfirmDialog, DescriptionList, FormGrid,
  Inline, Input, Mono, SectionTitle, Select, Stack, Textarea,
} from "@/components/ui/index";
import { formatDateTime } from "@/format";
import type {
  ResolveConflictResponse, WorkdayConflictDetail,
} from "@gradix/contracts";
import { hhmm, isHhmm, KIND_LABEL, shiftToHhmm, timesLabel } from "../conflict-shared";

export function ConflictDetailClient({ initial }: { initial: WorkdayConflictDetail }) {
  const [detail, setDetail] = useState<WorkdayConflictDetail>(initial);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const [acceptTarget, setAcceptTarget] = useState<"SERVER" | "RECEIVED" | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [corrOpen, setCorrOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [internalNote, setInternalNote] = useState(initial.internalNote ?? "");
  const base = initial.server?.times ?? initial.received?.times;
  const [corrStart, setCorrStart] = useState(base ? hhmm(base.startedAt) : "");
  const [corrEnd, setCorrEnd] = useState(base?.endedAt ? hhmm(base.endedAt) : "");
  const [corrTarget, setCorrTarget] = useState<"SERVER" | "RECEIVED">(initial.server ? "SERVER" : "RECEIVED");
  const [busy, setBusy] = useState(false);

  const resolved = detail.status === "RESOLVED";

  const reload = useCallback(async () => {
    const res = await apiCall<{ conflict: WorkdayConflictDetail }>(`/api/workday-conflicts/${detail.id}`);
    if (res.ok) {
      setDetail(res.data.conflict);
      setInternalNote(res.data.conflict.internalNote ?? "");
    }
  }, [detail.id]);

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
    setBusy(true);
    const body: Record<string, unknown> = {
      kind,
      reason,
      internalNote: internalNote.trim() ? internalNote.trim() : null,
      idempotencyKey: `${detail.id}-${kind}-${Date.now()}`,
    };
    if (kind === "CORRECTED_TIMES") {
      const target = corrTarget === "SERVER" ? detail.server?.times : detail.received?.times;
      if (!target) { setBusy(false); return; }
      const startedAt = shiftToHhmm(target.startedAt, corrStart);
      const endedAt = target.endedAt ? shiftToHhmm(target.endedAt, corrEnd) : null;
      if (!startedAt || (target.endState === "KNOWN_END" && !endedAt)) {
        setBusy(false);
        setNotice({ tone: "error", text: "Vremena moraju biti u obliku HH:MM (24 h) — ništa nije sačuvano." });
        return;
      }
      body.correctedTimes = { startedAt, endedAt, endState: target.endState };
      body.correctedTarget = corrTarget;
    }
    const res = await apiCall<ResolveConflictResponse>(`/api/workday-conflicts/${detail.id}/resolve`, jsonBody(body));
    setBusy(false);
    setAcceptTarget(null);
    setRejectOpen(false);
    setCorrOpen(false);
    if (!res.ok) {
      setNotice({ tone: "error", text: res.message });
      return;
    }
    applyOutcome(res.data);
    await reload();
  }, [detail, reason, internalNote, corrStart, corrEnd, corrTarget, applyOutcome, reload]);

  const openCorrection = useCallback(() => {
    if (!isHhmm(corrStart) || (corrEnd.trim() !== "" && !isHhmm(corrEnd))) {
      setNotice({
        tone: "error",
        text: "Neispravno vrijeme: upišite početak i kraj kao HH:MM u 24-satnom obliku (npr. 07:30). Ništa nije sačuvano.",
      });
      return;
    }
    setNotice(null);
    setReason("");
    setCorrOpen(true);
  }, [corrStart, corrEnd]);

  return (
    <Stack>
      {notice ? (
        <Alert tone={notice.tone === "success" ? "success" : notice.tone === "warning" ? "warning" : "error"}>
          {notice.text}
        </Alert>
      ) : null}

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
          {detail.clockSkewMinutes !== null ? (
            <Chip tone="hollow">Sat telefona odstupa{detail.clockSkewMinutes ? ` +${detail.clockSkewMinutes} min` : ""}</Chip>
          ) : null}
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
            Ispravka vremena i interna napomena
          </SectionTitle>
          <FormGrid>
            <Select label="Unos koji se ispravlja" value={corrTarget} onChange={(event) => setCorrTarget(event.target.value as "SERVER" | "RECEIVED")}>
              <option value="SERVER">Unos sa servera</option>
              <option value="RECEIVED">Unos s telefona</option>
            </Select>
            <Input label="Početak (HH:MM, 24 h)" value={corrStart} onChange={(event) => setCorrStart(event.target.value)} placeholder="07:30" />
            <Input label="Kraj (HH:MM, 24 h)" value={corrEnd} onChange={(event) => setCorrEnd(event.target.value)} placeholder="15:30" />
          </FormGrid>
          <Textarea
            label="Interna napomena ureda (nikad se ne prikazuje radniku)"
            hint="Vidi je samo ured. Ne ide na telefon ni u razlog koji radnik čita."
            value={internalNote}
            onChange={(event) => setInternalNote(event.target.value)}
            maxLength={2000}
          />
        </Card>
      )}

      {/* Akcije su uvijek na istom mjestu: ljepljiva traka pri dnu ekrana.
          Kod razriješenog sukoba ostaju vidljive, ali ugašene. */}
      <div className="gx-actionbar">
        <Inline>
          <Button variant="primary" disabled={resolved || busy} onClick={() => { setReason(""); setAcceptTarget("SERVER"); }}>
            Prihvati ovaj unos
          </Button>
          <span className="gx-actionbar__label">sa servera</span>
          <Button variant="primary" disabled={resolved || busy} onClick={() => { setReason(""); setAcceptTarget("RECEIVED"); }}>
            Prihvati ovaj unos
          </Button>
          <span className="gx-actionbar__label">s telefona</span>
          <Button disabled={resolved || busy} onClick={openCorrection}>Ispravi vremena</Button>
          <Button disabled={resolved || busy} onClick={() => { setReason(""); setRejectOpen(true); }}>Odbaci uz razlog</Button>
        </Inline>
      </div>

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
        onConfirm={() => void resolve("CORRECTED_TIMES")}
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

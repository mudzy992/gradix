/**
 * Radnik — „Moj dan“, timer-first (spec 03 §1.1).
 *
 * Pravila koja ekran sprovodi:
 *  - **Jedno veliko dugme.** Na gradilištu se telefon drži jednom rukom i u rukavici; glavna
 *    akcija je `≥ 56 dp` (`touchTarget`) i nikad nije u meniju.
 *  - **Ručni unos je iza „Unesi ručno“.** Forma je rezerva, ne početni ekran — ako je na vrhu,
 *    radnik uvijek bira nju i timer nikad ne zaživi.
 *  - **Zaboravljen dan ide prvi.** Dok je stari dan otvoren, novi se ne počinje: inače bi dva
 *    otvorena segmenta bila nemoguća (unique indeks to i brani u bazi).
 *  - **Upozorenje ne blokira.** Crvena traka (`blockers`) piše šta ured treba da uradi, ali
 *    dugme ostaje aktivno — radnik je fizički na gradilištu i mora moći da upiše sate.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { closeForgottenDay, myDay, workdayTimer } from "../api/client";
import { getActiveLocalAccount, readOutboxEntries, readResolutionOutcomes, type LocalOutboxEntry } from "../db/r4-outbox";
import { openDb } from "../db/sqlite";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import type { ResolutionDisplay } from "../sync/r4-resolution";
import { outcomeFor, sendResultMessage, syncBannerText } from "../teren/outcome";
import { AlertBox, Banner, Button, CardView, ListItem, Screen, StatusChip, Text } from "../ui";
import {
  type DayView,
  type MyDayView,
  assignmentPickerNeeded,
  elapsedLabel,
  forgottenPrompt,
  mainAction,
  tzOffsetMinutes,
} from "../teren/moj-dan-model";
import { ManualEntry } from "../teren/moj-dan-manual";

export default function MojDanScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<MyDayView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [forgottenOpen, setForgottenOpen] = useState(false);
  const [tick, setTick] = useState(0);
  /*
   * Lokalni outbox ostaje dio ekrana: timer piše na server, ali zapisi koji još nisu poslani iz
   * starog toka (`R4 outbox`) moraju biti vidljivi — radnik koji ne vidi šta čeka vjeruje da je
   * poslano. Bez ovoga bi ekran tiho sakrio sporne zapise.
   */
  const [entries, setEntries] = useState<LocalOutboxEntry[]>([]);
  const [resolutions, setResolutions] = useState<Map<string, ResolutionDisplay>>(new Map());
  const [syncFailed, setSyncFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState((await myDay()) as MyDayView);
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (account) {
        setEntries(await readOutboxEntries(db, account));
        setResolutions(await readResolutionOutcomes(db, account));
      }
    } catch {
      setError("Podaci se nisu mogli učitati. Provjeri vezu i pokušaj ponovo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Otkucaj svakih 30 s: „traje 2 h 14 min“ mora da se mijenja i bez dodirivanja ekrana.
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const pending = entries.filter((entry) => entry.status === "pending" || entry.status === "failed").length;
  const today = state?.today ?? null;
  const forgotten = state?.forgotten ?? null;
  const action = useMemo(() => mainAction(today), [today]);
  const needsPicker = assignmentPickerNeeded(state, today);

  async function runTimer(next: "start" | "pause" | "resume" | "finish") {
    if (needsPicker && next === "start") {
      setMessage("Danas imaš više dodjela — izaberi projekat u listi ispod.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await workdayTimer({
        action: next,
        // `localId` je ključ idempotencije: ponovni tap ne otvara drugi segment.
        localId: `md_${next}_${Date.now()}`,
        at: new Date().toISOString(),
        tzOffsetMinutes: tzOffsetMinutes(new Date()),
        projectId: today?.segments[0]?.projectId ?? state?.assignments[0]?.projectId ?? null,
      });
      await load();
    } catch {
      setMessage("Nije prošlo. Provjeri vezu — zapis nije nigdje izgubljen.");
    } finally {
      setBusy(false);
    }
  }

  /** Ručno slanje lokalnog outboxa — ostaje kao izlaz kad veza proradi. */
  async function sendOutbox() {
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      const outcome = await runSqliteR4Sync(db, account);
      setEntries(await readOutboxEntries(db, account));
      setResolutions(await readResolutionOutcomes(db, account));
      setSyncFailed(outcome.retry > 0);
      setMessage(sendResultMessage(outcome));
    } catch {
      setMessage("Slanje nije uspjelo. Zapisi ostaju na telefonu.");
    } finally {
      setBusy(false);
    }
  }

  async function answerForgotten(kind: "LAST_PING" | "UNKNOWN") {
    setBusy(true);
    setMessage(null);
    try {
      await closeForgottenDay({
        kind,
        lastPingAt: kind === "LAST_PING" ? new Date().toISOString() : undefined,
        note: kind === "UNKNOWN" ? "Radnik ne zna kada je prestao — provjeriti na gradilištu." : null,
      });
      setForgottenOpen(false);
      await load();
    } catch {
      setMessage("Odgovor nije poslan. Pokušaj ponovo kad bude veze.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Moj dan"
      subtitle="Jedno dugme za početak, pauzu i kraj. Ručni unos je iza „Unesi ručno“."
      loading={loading}
      error={error}
      empty={state && !today && state.assignments.length === 0 ? "Nema dodijeljenih projekata. Obrati se šefu." : null}
      onRetry={load}
    >
      {/*
        Crvena traka iz `canUseEntity`: piše, ne blokira. Radnik koji čeka ljekarski nalaz i dalje
        radi, pa i dalje mora da upiše sate — blokada bi ga natjerala da laže.
      */}
      <Banner>{syncBannerText({ pending, syncFailed: syncFailed || entries.some((entry) => entry.status === "failed") })}</Banner>

      {today?.assignmentWarning ? (
        <Banner>
          Danas nemaš važeću dodjelu na projektu. Sati se bilježe, a ured vidi da dodjela nedostaje.
        </Banner>
      ) : null}

      {forgotten && forgottenPrompt(forgotten) ? (
        <CardView>
          <Text variant="label">Prethodni dan je ostao otvoren</Text>
          <Text variant="muted">{forgottenPrompt(forgotten)}</Text>
          {forgottenOpen ? (
            <View style={{ gap: 12 }}>
              <Button label="Znam kada sam prestao (unesi vrijeme)" busy={busy} onPress={() => setManualOpen(true)} />
              <Button label="Zadnji otkucaj telefona" busy={busy} onPress={() => void answerForgotten("LAST_PING")} />
              <Button label="Ne znam — neka ured provjeri" busy={busy} onPress={() => void answerForgotten("UNKNOWN")} />
              <Button label="Odustani" busy={busy} onPress={() => setForgottenOpen(false)} />
            </View>
          ) : (
            <Button label="Odgovori na otvoreni dan" busy={busy} onPress={() => setForgottenOpen(true)} />
          )}
        </CardView>
      ) : null}

      <CardView>
        <Text variant="label">{action.title}</Text>
        {today && today.segments.length > 0 ? (
          <Text variant="muted">
            {elapsedLabel(today, new Date(), tick)} · ukupno {Math.round(today.minutes / 60)} h
            {today.openSegments > 0 ? " · mjeri se" : ""}
          </Text>
        ) : (
          <Text variant="muted">Još nije počeo. Pritisni dugme kad dođeš na gradilište.</Text>
        )}
        {/*
          Glavna akcija: `Button` u mobilnom UI-ju ima `minHeight: touchTarget` (56 dp), pa je
          ista veličina i u rukavici. Ne skraćujemo je na sekundarnu varijantu.
        */}
        <Button
          label={action.label}
          busy={busy}
          disabled={forgotten ? true : false}
          onPress={() => (action.next === "finish" ? void runTimer("finish") : void runTimer(action.next))}
        />
        {forgotten ? (
          <Text variant="caption">Prvo odgovori na prethodni dan — dva otvorena dana nisu dozvoljena.</Text>
        ) : null}
        {needsPicker ? (
          <AlertBox>Danas imaš više dodjela. Izaberi projekat prije početka rada.</AlertBox>
        ) : null}
        <Button label={manualOpen ? "Zatvori ručni unos" : "Unesi ručno"} busy={false} onPress={() => setManualOpen((v) => !v)} />
        {message ? <Text variant="muted">{message}</Text> : null}
      </CardView>

      {manualOpen ? <ManualEntry onSaved={() => void load()} /> : null}

      {state && state.assignments.length > 0 ? (
        <CardView>
          <Text variant="label">Današnje dodjele</Text>
          {state.assignments.map((assignment) => (
            <ListItem
              key={`${assignment.projectId}-${assignment.machineId ?? "none"}`}
              title={assignment.projectName}
              meta={assignment.machineName ?? "bez mašine"}
              right=""
            />
          ))}
        </CardView>
      ) : null}

      {today && today.segments.length > 0 ? (
        <CardView>
          <Text variant="label">Tok dana</Text>
          {today.segments.map((segment) => (
            <ListItem
              key={segment.id}
              title={`${segment.kind === "BREAK" ? "Pauza" : segment.projectName ?? "Rad"} · ${segment.startedAt.slice(11, 16)}`}
              meta={segment.endedAt ? `do ${segment.endedAt.slice(11, 16)}` : "traje"}
              right={segment.endState === "UNKNOWN_END" ? "kraj nepoznat" : ""}
            />
          ))}
        </CardView>
      ) : null}

      {entries.length > 0 ? (
        <CardView>
          <Text variant="label">Moji zapisi i ishod slanja</Text>
          {entries.map((entry) => {
            const resolution = resolutions.get(entry.localId);
            return (
              <ListItem
                key={entry.localId}
                title={entry.createdAt.slice(0, 10)}
                meta={resolution?.detail}
                right={resolution?.label ?? outcomeFor(entry.status, entry.lastError).label}
              />
            );
          })}
          {/* Slanje je izričita radnja: telefon ne šalje sam od sebe kad radnik to ne vidi. */}
          {pending > 0 ? <Button label="Pošalji sada" busy={busy} onPress={() => void sendOutbox()} /> : null}
        </CardView>
      ) : null}

      {today?.reviewState && today.reviewState !== "OK" ? (
        <StatusChip
          label={today.reviewState === "UNKNOWN_END" ? "Ured provjerava ovaj dan" : "Dan čeka provjeru ureda"}
          tone="warn"
        />
      ) : null}

      <ScrollView />
    </Screen>
  );
}

/** Tipovi se izvoze za test modela; ekran ih ne koristi direktno. */
export type { DayView };

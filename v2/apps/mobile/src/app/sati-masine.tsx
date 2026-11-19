/**
 * R5.1 — rukovalac mašine: offline unos sati → R4 outbox (machine_work_log).
 */
import { useCallback, useEffect, useState } from "react";
import { machines, me } from "../api/client";
import { getActiveLocalAccount, queueMachineWorkLog, readOutboxEntries, type LocalOutboxEntry } from "../db/r4-outbox";
import { openDb } from "../db/sqlite";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import { Banner, Button, CardView, ListItem, Screen, Segmented, Text, TextField } from "../ui";
import { syncBannerText } from "../teren/outcome";
import { sendResultMessage } from "../teren/outcome";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function workLogId(): string {
  const cryptoObject = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  const raw = cryptoObject?.randomUUID?.().replace(/-/g, "").slice(0, 16) ?? String(Date.now());
  return `mwl_${raw}`;
}

export default function SatiMasineScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [machineList, setMachineList] = useState<{ id: string; code: string; name: string }[]>([]);
  const [machineId, setMachineId] = useState("");
  const [workDate, setWorkDate] = useState(todayIso());
  const [started, setStarted] = useState("07:30");
  const [ended, setEnded] = useState("15:30");
  const [mode, setMode] = useState<"WORK" | "IDLE" | "BREAKDOWN">("WORK");
  const [meterEnd, setMeterEnd] = useState("");
  const [entries, setEntries] = useState<LocalOutboxEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await me();
      if (!profile.user.roles.includes("MACHINE_OPERATOR")) {
        setError("Ovaj ekran je namijenjen rukovaocu mašine.");
        return;
      }
      const machineData = await machines();
      setMachineList(machineData.machines);
      setMachineId((current) => current || machineData.machines[0]?.id || "");
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (account) setEntries(await readOutboxEntries(db, account));
    } catch {
      setError("Podaci se nisu mogli učitati. Provjeri vezu i pokušaj ponovo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const pending = entries.filter((entry) => entry.status === "pending" || entry.status === "failed").length;

  async function save() {
    if (!machineId) {
      setMessage("Izaberi mašinu.");
      return;
    }
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      await queueMachineWorkLog(db, account, workLogId(), {
        machineId,
        projectId: null,
        startedAt: `${workDate}T${started}:00+01:00`,
        endedAt: `${workDate}T${ended}:00+01:00`,
        mode,
        meterEnd: meterEnd.trim() ? Number(meterEnd) : null,
        note: null,
      });
      setEntries(await readOutboxEntries(db, account));
      setMessage("Sačuvano na telefonu. Pošalji kad bude veze.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unos se nije mogao sačuvati.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      const outcome = await runSqliteR4Sync(db, account);
      setEntries(await readOutboxEntries(db, account));
      setMessage(sendResultMessage(outcome));
    } catch {
      setMessage("Slanje nije uspjelo. Zapisi ostaju na telefonu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Sati mašine"
      subtitle="Interval rada i brojilo — prvo na telefon, pa sync."
      loading={loading}
      error={error}
      empty={machineList.length === 0 ? "Nema aktivnih mašina za unos. Obrati se uredu." : null}
      onRetry={load}
    >
      <Banner>{syncBannerText({ pending, syncFailed: entries.some((entry) => entry.status === "failed") })}</Banner>
      <CardView>
        <Segmented
          label="Mašina"
          value={machineId}
          onChange={setMachineId}
          options={machineList.map((machine) => ({ value: machine.id, label: `${machine.code} · ${machine.name}` }))}
        />
        <TextField label="Datum (GGGG-MM-DD)" value={workDate} onChangeText={setWorkDate} accessibilityLabel="Datum rada" />
        <TextField label="Početak (HH:MM)" value={started} onChangeText={setStarted} accessibilityLabel="Početak" />
        <TextField label="Kraj (HH:MM)" value={ended} onChangeText={setEnded} accessibilityLabel="Kraj" />
        <Segmented
          label="Režim"
          value={mode}
          onChange={(value) => setMode(value as "WORK" | "IDLE" | "BREAKDOWN")}
          options={[
            { value: "WORK", label: "Rad" },
            { value: "IDLE", label: "Mirovanje" },
            { value: "BREAKDOWN", label: "Kvar" },
          ]}
        />
        <TextField label="Brojilo (opcionalno)" value={meterEnd} onChangeText={setMeterEnd} keyboardType="decimal-pad" />
        <Button label="Sačuvaj na telefon" busy={busy} onPress={save} />
        <Button label="Pošalji sada" busy={busy} onPress={send} />
      </CardView>
      {message ? <Text>{message}</Text> : null}
      {entries.slice(0, 5).map((entry) => (
        <ListItem key={entry.localId} title={entry.status} meta={entry.lastError ?? entry.createdAt} />
      ))}
    </Screen>
  );
}
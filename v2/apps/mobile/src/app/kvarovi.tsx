/**
 * R5.5 — rukovalac/mehaničar: offline prijava kvara → R4 outbox.
 */
import { useCallback, useEffect, useState } from "react";
import { machines, me } from "../api/client";
import { getActiveLocalAccount, queueMachineFault, readOutboxEntries, type LocalOutboxEntry } from "../db/r4-outbox";
import { openDb } from "../db/sqlite";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import { Banner, Button, CardView, ListItem, Screen, Text, TextField } from "../ui";
import { syncBannerText, sendResultMessage } from "../teren/outcome";

import { calendarDateFromLocalDate } from "@gradix/domain";

function todayIso(): string {
  return calendarDateFromLocalDate(new Date());
}

function faultId(): string {
  const cryptoObject = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  const raw = cryptoObject?.randomUUID?.().replace(/-/g, "").slice(0, 16) ?? String(Date.now());
  return `mf_${raw}`;
}

export default function KvaroviScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [machineList, setMachineList] = useState<{ id: string; code: string; name: string }[]>([]);
  const [machineId, setMachineId] = useState("");
  const [reportedDate, setReportedDate] = useState(todayIso());
  const [reportedTime, setReportedTime] = useState("08:00");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<LocalOutboxEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await me();
      const roles = profile.user.roles;
      if (!roles.includes("MACHINE_OPERATOR") && !roles.includes("MECHANIC")) {
        setError("Ovaj ekran je namijenjen rukovaocu ili mehaničaru.");
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
    if (!machineId || !title.trim()) {
      setMessage("Mašina i naslov su obavezni.");
      return;
    }
    const normalized = priority.trim().toUpperCase();
    const pri = (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(normalized)
      ? normalized
      : "MEDIUM") as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    const amount = cost.trim() || null;
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      await queueMachineFault(db, account, faultId(), {
        machineId,
        projectId: null,
        partnerId: null,
        reportedAt: `${reportedDate}T${reportedTime}:00+01:00`,
        title: title.trim(),
        description: note.trim() || null,
        priority: pri,
        estimatedCostAmount: amount,
        currencyCode: amount ? "BAM" : null,
        downtimeMinutes: null,
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
      title="Kvarovi"
      subtitle="Prijava kvara — prvo na telefon, pa sync."
      loading={loading}
      error={error}
      empty={machineList.length === 0 ? "Nema aktivnih mašina za unos." : null}
      onRetry={load}
    >
      <Banner>{syncBannerText({ pending, syncFailed: entries.some((entry) => entry.status === "failed") })}</Banner>
      <CardView>
        <TextField label="Mašina ID" value={machineId} onChangeText={setMachineId} accessibilityLabel="Mašina" />
        <TextField label="Datum" value={reportedDate} onChangeText={setReportedDate} accessibilityLabel="Datum" />
        <TextField label="Vrijeme (HH:MM)" value={reportedTime} onChangeText={setReportedTime} accessibilityLabel="Vrijeme" />
        <TextField label="Naslov" value={title} onChangeText={setTitle} accessibilityLabel="Naslov kvara" />
        <TextField label="Prioritet (LOW/MEDIUM/HIGH/CRITICAL)" value={priority} onChangeText={setPriority} />
        <TextField label="Procijenjeni trošak (npr. 120.00)" value={cost} onChangeText={setCost} />
        <TextField label="Opis" value={note} onChangeText={setNote} />
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

/**
 * R5.2 — vozač: offline unos goriva → R4 outbox (fuel_entry).
 */
import { useCallback, useEffect, useState } from "react";
import { machines, me } from "../api/client";
import { getActiveLocalAccount, queueFuelEntry, readOutboxEntries, type LocalOutboxEntry } from "../db/r4-outbox";
import { openDb } from "../db/sqlite";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import { Banner, Button, CardView, ListItem, Screen, Text, TextField } from "../ui";
import { syncBannerText, sendResultMessage } from "../teren/outcome";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fuelEntryId(): string {
  const cryptoObject = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  const raw = cryptoObject?.randomUUID?.().replace(/-/g, "").slice(0, 16) ?? String(Date.now());
  return `fuel_${raw}`;
}

export default function GorivoScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [machineList, setMachineList] = useState<{ id: string; code: string; name: string }[]>([]);
  const [machineId, setMachineId] = useState("");
  const [filledDate, setFilledDate] = useState(todayIso());
  const [filledTime, setFilledTime] = useState("12:00");
  const [liters, setLiters] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [meterReading, setMeterReading] = useState("");
  const [entries, setEntries] = useState<LocalOutboxEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await me();
      const allowed = profile.user.roles.includes("DRIVER") || profile.user.roles.includes("MACHINE_OPERATOR");
      if (!allowed) {
        setError("Ovaj ekran je namijenjen vozaču ili rukovaocu.");
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
    if (!machineId || !liters.trim()) {
      setMessage("Mašina i litre su obavezni.");
      return;
    }
    const amount = totalAmount.trim() || "0.00";
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      await queueFuelEntry(db, account, fuelEntryId(), {
        machineId,
        projectId: null,
        filledAt: `${filledDate}T${filledTime}:00+01:00`,
        liters: Number(liters),
        totalAmount: amount,
        currencyCode: "BAM",
        unitPriceAmount: null,
        meterReading: meterReading.trim() ? Number(meterReading) : null,
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
      title="Gorivo"
      subtitle="Točenje po mašini — prvo na telefon, pa sync."
      loading={loading}
      error={error}
      empty={machineList.length === 0 ? "Nema aktivnih mašina za unos." : null}
      onRetry={load}
    >
      <Banner>{syncBannerText({ pending, syncFailed: entries.some((entry) => entry.status === "failed") })}</Banner>
      <CardView>
        <TextField label="Mašina ID" value={machineId} onChangeText={setMachineId} accessibilityLabel="Mašina" />
        <TextField label="Datum" value={filledDate} onChangeText={setFilledDate} accessibilityLabel="Datum" />
        <TextField label="Vrijeme (HH:MM)" value={filledTime} onChangeText={setFilledTime} accessibilityLabel="Vrijeme" />
        <TextField label="Litara" value={liters} onChangeText={setLiters} keyboardType="decimal-pad" />
        <TextField label="Ukupan iznos (opcionalno)" value={totalAmount} onChangeText={setTotalAmount} keyboardType="decimal-pad" />
        <TextField label="Brojilo (opcionalno)" value={meterReading} onChangeText={setMeterReading} keyboardType="decimal-pad" />
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
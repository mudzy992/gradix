/**
 * R5.3 — vozač: offline unos ture → R4 outbox (haul).
 */
import { useCallback, useEffect, useState } from "react";
import { machines, me } from "../api/client";
import { getActiveLocalAccount, queueHaul, readOutboxEntries, type LocalOutboxEntry } from "../db/r4-outbox";
import { openDb } from "../db/sqlite";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import { Banner, Button, CardView, ListItem, Screen, Text, TextField } from "../ui";
import { syncBannerText, sendResultMessage } from "../teren/outcome";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function haulId(): string {
  const cryptoObject = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  const raw = cryptoObject?.randomUUID?.().replace(/-/g, "").slice(0, 16) ?? String(Date.now());
  return `haul_${raw}`;
}

export default function TureScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [machineList, setMachineList] = useState<{ id: string; code: string; name: string }[]>([]);
  const [machineId, setMachineId] = useState("");
  const [hauledDate, setHauledDate] = useState(todayIso());
  const [hauledTime, setHauledTime] = useState("12:00");
  const [originText, setOriginText] = useState("");
  const [destinationText, setDestinationText] = useState("");
  const [materialText, setMaterialText] = useState("");
  const [quantity, setQuantity] = useState("");
  const [quantityUnit, setQuantityUnit] = useState("M3");
  const [tripCount, setTripCount] = useState("1");
  const [scaleTicketText, setScaleTicketText] = useState("");
  const [entries, setEntries] = useState<LocalOutboxEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await me();
      if (!profile.user.roles.includes("DRIVER")) {
        setError("Ovaj ekran je namijenjen vozaču.");
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
    if (!machineId || !originText.trim() || !destinationText.trim() || !materialText.trim() || !quantity.trim()) {
      setMessage("Mašina, ruta, materijal i količina su obavezni.");
      return;
    }
    const unit = quantityUnit.trim().toUpperCase() === "T" ? "T" : "M3";
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      await queueHaul(db, account, haulId(), {
        machineId,
        projectId: null,
        segmentId: null,
        hauledAt: `${hauledDate}T${hauledTime}:00+01:00`,
        originText: originText.trim(),
        destinationText: destinationText.trim(),
        materialText: materialText.trim(),
        quantity: Number(quantity),
        quantityUnit: unit,
        scaleTicketText: scaleTicketText.trim() || null,
        tripCount: Math.max(1, Number(tripCount) || 1),
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
      title="Ture"
      subtitle="Tura po kamionu — prvo na telefon, pa sync."
      loading={loading}
      error={error}
      empty={machineList.length === 0 ? "Nema aktivnih mašina za unos." : null}
      onRetry={load}
    >
      <Banner>{syncBannerText({ pending, syncFailed: entries.some((entry) => entry.status === "failed") })}</Banner>
      <CardView>
        <TextField label="Mašina ID" value={machineId} onChangeText={setMachineId} accessibilityLabel="Mašina" />
        <TextField label="Datum" value={hauledDate} onChangeText={setHauledDate} accessibilityLabel="Datum" />
        <TextField label="Vrijeme (HH:MM)" value={hauledTime} onChangeText={setHauledTime} accessibilityLabel="Vrijeme" />
        <TextField label="Polazište" value={originText} onChangeText={setOriginText} />
        <TextField label="Odredište" value={destinationText} onChangeText={setDestinationText} />
        <TextField label="Materijal" value={materialText} onChangeText={setMaterialText} />
        <TextField label="Količina" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
        <TextField label="Jedinica (M3 ili T)" value={quantityUnit} onChangeText={setQuantityUnit} />
        <TextField label="Broj tura" value={tripCount} onChangeText={setTripCount} keyboardType="number-pad" />
        <TextField label="Vaga (opcionalno)" value={scaleTicketText} onChangeText={setScaleTicketText} />
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

/** F9: prijava opasnosti ostaje na uređaju dok se ne pošalje, i bez mreže. */
import { useCallback, useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import type { HseIncidentKindCode, HseSeverityCode } from "@gradix/domain";
import { getActiveLocalAccount, queueHseIncident, readOutboxEntries, type LocalOutboxEntry } from "../../db/r4-outbox";
import { openDb } from "../../db/sqlite";
import { runSqliteR4Sync } from "../../sync/r4-sqlite";
import { sendResultMessage, syncBannerText } from "../../teren/outcome";
import { Banner, Button, CardView, CheckboxRow, ListItem, Screen, Segmented, Text, TextField } from "../../ui";

export default function HsePrijavaScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<LocalOutboxEntry[]>([]);
  const [kind, setKind] = useState<HseIncidentKindCode>("NEAR_MISS");
  const [severity, setSeverity] = useState<HseSeverityCode>("MINOR");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString());
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [action, setAction] = useState("");
  const [lostDays, setLostDays] = useState("0");
  const [injuredWorkerId, setInjuredWorkerId] = useState("");
  const [reportable, setReportable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const saving = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju. Prijavi se uz vezu.");
      setEntries(await readOutboxEntries(db, account));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lokalni podaci nisu dostupni.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (saving.current) return;
    if (description.trim().length < 5) {
      setMessage("Opiši događaj sa najmanje 5 znakova.");
      return;
    }
    if (kind !== "NEAR_MISS" && (!/^\d+$/.test(lostDays) || Number(lostDays) > 3650)) {
      setMessage("Izgubljeni dani moraju biti cijeli broj između 0 i 3650.");
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      await queueHseIncident(db, account, {
        incidentId: `hsi_${randomUUID()}`,
        incident: {
          kind, severity, occurredAt: occurredAt.trim(), projectId: null,
          locationText: location.trim() || null, lat: null, lng: null,
          description: description.trim(), immediateAction: action.trim() || null,
          injuredWorkerId: kind === "NEAR_MISS" ? null : injuredWorkerId.trim() || null,
          lostDays: kind === "NEAR_MISS" ? 0 : Number(lostDays), reportableToAuthority: reportable,
          photos: [], updateBody: null,
        },
      });
      // Nakon trajnog upisa ne prijavljuj grešku kao da upis nije uspio: novi tap bi duplicirao prijavu.
      setDescription("");
      setLocation("");
      setAction("");
      setLostDays("0");
      setInjuredWorkerId("");
      setReportable(false);
      setOccurredAt(new Date().toISOString());
      setMessage("Prijava je sačuvana na telefonu, još nije poslana.");
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Prijava nije sačuvana. Pokušaj ponovo.");
    } finally {
      saving.current = false;
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
      setSyncFailed(outcome.retry > 0);
      setMessage(`${sendResultMessage(outcome)} Odbijeno: ${outcome.rejected}.`);
      await load();
    } catch {
      setSyncFailed(true);
      setMessage("Slanje nije uspjelo. Zapisi ostaju na telefonu.");
    } finally {
      setBusy(false);
    }
  }

  const pending = entries.filter((entry) => entry.status === "pending" || entry.status === "failed").length;
  const needsReview = entries.filter((entry) => entry.status === "rejected" || entry.status === "conflict").length;
  return (
    <Screen title="Prijava opasnosti" subtitle="Prijavi događaj i bez mreže; slanje je odvojeni korak."
      loading={loading} error={error} empty={null} onRetry={load}>
      <Banner>{syncBannerText({ pending, syncFailed })} {needsReview > 0 ? `${needsReview} zahtijeva provjeru.` : ""}</Banner>
      {!error ? <CardView>
        <Segmented label="Vrsta događaja" value={kind} onChange={setKind} options={[
          { value: "NEAR_MISS", label: "Izbjegnuta nezgoda" }, { value: "ACCIDENT", label: "Nesreća" },
          { value: "PROPERTY_DAMAGE", label: "Materijalna šteta" }, { value: "ENVIRONMENTAL", label: "Okoliš" },
          { value: "OCCUPATIONAL_ILLNESS", label: "Profesionalno oboljenje" },
        ]} />
        <Segmented label="Ozbiljnost" value={severity} onChange={setSeverity} options={[
          { value: "MINOR", label: "Manja" }, { value: "MODERATE", label: "Umjerena" },
          { value: "SEVERE", label: "Teška" }, { value: "FATAL", label: "Smrtna" },
        ]} />
        <TextField label="Vrijeme događaja (ISO, s vremenskom zonom)" value={occurredAt} onChangeText={setOccurredAt} autoCapitalize="none" />
        <TextField label="Šta se dogodilo?" value={description} onChangeText={setDescription} multiline />
        <TextField label="Mjesto događaja (opcionalno)" value={location} onChangeText={setLocation} />
        <TextField label="Šta je odmah poduzeto? (opcionalno)" value={action} onChangeText={setAction} />
        {kind !== "NEAR_MISS" ? <>
          <TextField label="Izgubljeni dani" value={lostDays} onChangeText={setLostDays} keyboardType="number-pad" />
          <TextField label="ID povrijeđenog radnika (opcionalno)" value={injuredWorkerId} onChangeText={setInjuredWorkerId} autoCapitalize="none" />
        </> : null}
        <CheckboxRow label="Potrebna prijava nadležnom organu" checked={reportable} onToggle={() => setReportable(!reportable)} />
        <Text variant="muted">Prijava ne veže projekat niti šalje fotografije. Povrijeđeni se upisuje ID-em; provjeri činjenice prije slanja jer se ne prepisuju.</Text>
        <Button label="Sačuvaj na telefon" busy={busy} onPress={() => void save()} />
        <Button label="Pošalji sada" variant="secondary" busy={busy} onPress={() => void send()} />
      </CardView> : null}
      {message ? <Text>{message}</Text> : null}
      <Text variant="label">Zapisi ovog naloga na telefonu</Text>
      {entries.slice(0, 10).map((entry) => <ListItem key={entry.localId}
        title={entry.status === "sent" ? "Poslano" : entry.status === "rejected" ? "Odbijeno — provjeri s uredom" : entry.status === "conflict" ? "Za provjeru" : "Čeka slanje"}
        meta={entry.lastError ?? entry.createdAt} />)}
    </Screen>
  );
}

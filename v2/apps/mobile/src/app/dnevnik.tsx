/** Početni mobilni dnevnik: lokalni nacrt i pregled zadnjeg server presjeka. */
import { useCallback, useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import { calendarDateFromLocalDate, R4_SYNC_PUSH_MAX_ITEM_BYTES, type DiaryWeather, type R4DiaryDelayPayload } from "@gradix/domain";
import type { SiteDiaryDetail } from "@gradix/contracts";
import { fetchDiaryDetail } from "../api/client";
import { cacheDiaryDetail, clearDiaryDetailCache, getActiveLocalAccount, hasUnresolvedDiaryEdit, queueSiteDiary, queueSiteDiaryItem,
  readDiaryDetailCache, readOutboxEntries, type LocalOutboxEntry } from "../db/r4-outbox";
import { openDb, readProjects, type LocalProject } from "../db/sqlite";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import { sendResultMessage } from "../teren/outcome";
import { Banner, Button, CardView, ListItem, Screen, Text, TextField } from "../ui";

const WEATHER: { value: DiaryWeather; label: string }[] = [
  { value: "CLEAR", label: "Vedro" }, { value: "CLOUDY", label: "Oblačno" },
  { value: "RAIN", label: "Kiša" }, { value: "SNOW", label: "Snijeg" },
  { value: "WIND", label: "Vjetar" }, { value: "FROST", label: "Mraz" }, { value: "HEAT", label: "Vrućina" },
];

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export default function DnevnikScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState(() => calendarDateFromLocalDate(new Date()));
  const [detail, setDetail] = useState<SiteDiaryDetail | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [entries, setEntries] = useState<LocalOutboxEntry[]>([]);
  const [weather, setWeather] = useState<DiaryWeather | null>(null);
  const [temperature, setTemperature] = useState("");
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [visitors, setVisitors] = useState("");
  const [events, setEvents] = useState("");
  const [delayFrom, setDelayFrom] = useState("");
  const [delayTo, setDelayTo] = useState("");
  const [delayHours, setDelayHours] = useState("");
  const [delayNote, setDelayNote] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemUnit, setItemUnit] = useState("");
  const [itemQuantity, setItemQuantity] = useState("");
  const [signedName, setSignedName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const requestId = useRef(0);
  const hasUnsaved = Boolean(weather || temperature || hours || description || visitors || events || delayFrom || delayTo || delayHours || delayNote ||
    itemDescription || itemUnit || itemQuantity || signedName);
  function discardInputs() {
    setWeather(null); setTemperature(""); setHours(""); setDescription(""); setVisitors(""); setEvents("");
    setDelayFrom(""); setDelayTo(""); setDelayHours(""); setDelayNote("");
    setItemDescription(""); setItemUnit(""); setItemQuantity(""); setSignedName("");
    setMessage("Nespremljeni unos je odbačen.");
  }

  const load = useCallback(async () => {
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      setProjects((await readProjects(db)).rows);
      setEntries(await readOutboxEntries(db, account));
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Lokalni podaci nisu dostupni."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function openDay(project: string, day: string, refresh: boolean) {
    const id = ++requestId.current;
    setDetail(null); setFetchedAt(null);
    if (!project || !validDate(day)) return;
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga.");
      let cached = await readDiaryDetailCache(db, account, project, day);
      if (refresh) {
        try {
          const remote = await fetchDiaryDetail(account, project, day);
          if (remote) { await cacheDiaryDetail(db, account, remote); cached = await readDiaryDetailCache(db, account, project, day); }
          else { await clearDiaryDetailCache(db, account, project, day); cached = null; }
          if (id === requestId.current) setMessage(remote ? "Dnevnik je osvježen." : "Server nema dnevnik za ovaj dan.");
        } catch { if (id === requestId.current) setMessage("Nema veze; prikazan je posljednji lokalni presjek ako postoji."); }
      }
      if (id !== requestId.current) return;
      setDetail(cached?.detail ?? null); setFetchedAt(cached?.fetchedAt ?? null);
    } catch (caught) { if (id === requestId.current) setMessage(caught instanceof Error ? caught.message : "Dnevnik nije dostupan."); }
  }

  async function save() {
    if (saving.current) return;
    if (!projectId || !validDate(date)) { setMessage("Izaberi projekat i ispravan datum (GGGG-MM-DD)."); return; }
    if (detail && detail.diary.status !== "DRAFT") { setMessage("Potpisani dnevnik se ne može mijenjati bez revizije."); return; }
    const hasDelay = Boolean(delayFrom || delayTo || delayHours || delayNote);
    const delays: R4DiaryDelayPayload[] = hasDelay
      ? [{ kind: "OTHER", fromAt: delayFrom.trim(), toAt: delayTo.trim(), hours: delayHours.trim(), note: delayNote.trim() || null }]
      : [];
    saving.current = true; setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga.");
      if (await hasUnresolvedDiaryEdit(db, account, projectId, date)) {
        throw new Error("Nacrt ovog dana već čeka slanje ili razrješenje. Prvo provjeri njegov ishod.");
      }
      await queueSiteDiary(db, account, {
        diaryId: detail?.diary.id ?? `sdr_${randomUUID()}`,
        baseVersion: detail?.diary.version ?? 1,
        diary: { projectId, diaryDate: date, weather, temperatureC: temperature.trim() || null,
          workedHours: hours.trim() || null, description: description.trim() || null,
          visitors: visitors.trim() || null, events: events.trim() || null, signedName: null, delays },
      });
      setMessage("Nacrt je sačuvan na telefonu; još nije poslan.");
      setWeather(null); setTemperature(""); setHours(""); setDescription(""); setVisitors(""); setEvents("");
      setDelayFrom(""); setDelayTo(""); setDelayHours(""); setDelayNote("");
      await load();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Nacrt nije sačuvan."); }
    finally { saving.current = false; setBusy(false); }
  }

  async function saveItem() {
    if (saving.current) return;
    if (!detail || detail.diary.projectId !== projectId || detail.diary.diaryDate !== date || detail.diary.status !== "DRAFT") {
      setMessage("Ručnu količinu možeš dodati tek kad je dan sačuvan na serveru i njegov nacrt osvježen."); return;
    }
    saving.current = true; setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga.");
      if (await hasUnresolvedDiaryEdit(db, account, projectId, date)) throw new Error("Najprije pošalji ili razriješi nacrt ovog dana.");
      await queueSiteDiaryItem(db, account, { diaryItemId: `sdi_${randomUUID()}`, diaryProjectId: projectId, diaryDate: date,
        item: { boqItemId: null, description: itemDescription.trim(), unit: itemUnit.trim(), quantity: itemQuantity.trim(), source: "MANUAL" } });
      setItemDescription(""); setItemUnit(""); setItemQuantity("");
      setMessage("Količina je sačuvana na telefonu; još nije poslana.");
      await load();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Količina nije sačuvana."); }
    finally { saving.current = false; setBusy(false); }
  }

  async function sign() {
    if (saving.current) return;
    if (!detail || detail.diary.projectId !== projectId || detail.diary.diaryDate !== date || detail.diary.status !== "DRAFT") {
      setMessage("Za potpis najprije osvježi sačuvani nacrt odabranog dana."); return;
    }
    if (signedName.trim().length < 2 || signedName.trim().length > 200) { setMessage("Potpis traži ime i prezime (2–200 znakova)."); return; }
    if (weather || temperature || hours || description || visitors || events || delayFrom || delayTo || delayHours || delayNote ||
        itemDescription || itemUnit || itemQuantity) {
      setMessage("Prvo sačuvaj i pošalji dopune i količine, pa osvježi presjek prije potpisa."); return;
    }
    saving.current = true; setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga.");
      if (await hasUnresolvedDiaryEdit(db, account, projectId, date)) throw new Error("Najprije pošalji ili razriješi sve nacrte i količine ovog dana.");
      const { generatedAt: _generatedAt, ...shownAuto } = detail.auto;
      const snapshot = JSON.stringify(shownAuto);
      const signedAt = new Date().toISOString();
      const diary = { projectId, diaryDate: date, weather: null, temperatureC: null, workedHours: null,
        description: null, visitors: null, events: null, delays: [], signedName: signedName.trim(),
        signature: { signedAt, autoSnapshotJson: snapshot } };
      // Računamo stvarni JSON s escape znakovima i UTF-8 bajtovima, uključujući sync omotač.
      const serialized = JSON.stringify({ localId: "00000000-0000-4000-8000-000000000000", entityType: "site_diary",
        diaryId: detail.diary.id, deviceSentAt: signedAt, baseVersion: detail.diary.version, diary });
      if (encodeURIComponent(serialized).replace(/%[0-9A-F]{2}|./gi, "x").length > R4_SYNC_PUSH_MAX_ITEM_BYTES) {
        throw new Error("Presjek je prevelik za offline potpis. Potpiši dnevnik na webu dok ne bude podržan veći presjek.");
      }
      await queueSiteDiary(db, account, { diaryId: detail.diary.id, baseVersion: detail.diary.version, diary });
      setSignedName("");
      setMessage("Potpis je sačuvan na telefonu; server će ga prihvatiti samo ako se presjek nije promijenio.");
      await load();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Potpis nije sačuvan."); }
    finally { saving.current = false; setBusy(false); }
  }

  async function send() {
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga.");
      const outcome = await runSqliteR4Sync(db, account);
      setMessage(`${sendResultMessage(outcome)} Odbijeno: ${outcome.rejected}.`);
      await load();
    } catch { setMessage("Slanje nije uspjelo; podaci ostaju na telefonu."); }
    finally { setBusy(false); }
  }

  return <Screen title="Dnevnik građenja" subtitle="Odaberi dan i dopuni nacrt; slanje je odvojena radnja."
    loading={loading} error={error} empty={null} onRetry={load}>
    <Banner>Automatski podaci su posljednji osvježeni presjek. Izbor stavki predmjera još nije dostupan.</Banner>
    <CardView>
      <Text variant="label">Projekat</Text>
      {projects.map((p) => <Button key={p.id} label={`${projectId === p.id ? "✓ " : ""}${p.code} · ${p.name}`}
        variant={projectId === p.id ? "primary" : "secondary"} onPress={() => {
          if (hasUnsaved && p.id !== projectId) { setMessage("Sačuvaj ili odbaci nespremljeni unos prije promjene projekta."); return; }
          setProjectId(p.id); void openDay(p.id, date, false);
        }} />)}
      {!projects.length ? <Text variant="muted">Nema lokalnih projekata. Osvježi projekte dok imaš mrežu.</Text> : null}
      <TextField label="Datum dnevnika (GGGG-MM-DD)" value={date} onChangeText={(value) => {
        if (hasUnsaved && value !== date) { setMessage("Sačuvaj ili odbaci nespremljeni unos prije promjene datuma."); return; }
        setDate(value); void openDay(projectId, value, false);
      }} />
      {hasUnsaved ? <Button label="Odbaci nespremljeni unos" variant="secondary" onPress={discardInputs} /> : null}
      <Button label="Osvježi dnevnik i automatske podatke" variant="secondary" onPress={() => void openDay(projectId, date, true)} />
      {detail ? <>
        <Text>Stanje: {detail.diary.status}, verzija {detail.diary.version}. Presjek: {fetchedAt}</Text>
        <Text>Vrijeme: {detail.diary.weather ?? "—"}; temperatura: {detail.diary.temperatureC ?? "—"}; sati: {detail.diary.workedHours ?? "—"}</Text>
        <Text>Radovi: {detail.diary.description ?? "—"}</Text>
        <Text>Posjetioci: {detail.diary.visitors ?? "—"}</Text>
        <Text>Događaji: {detail.diary.events ?? "—"}</Text>
        <Text variant="label">Zastoji</Text>
        {detail.delays.map((x) => <ListItem key={x.id} title={`${x.kind}: ${x.hours} h`} meta={`${x.fromAt} – ${x.toAt} ${x.note ?? ""}`} />)}
        <Text variant="label">Radnici</Text>
        {detail.auto.workers.map((x) => <ListItem key={x.workerId} title={x.workerName} meta={`${x.hours} sati`} />)}
        <Text variant="label">Mašine</Text>
        {detail.auto.machines.map((x) => <ListItem key={x.machineId} title={`${x.machineCode} · ${x.machineName}`} meta={`${x.hours} sati, brojilo ${x.meterFrom ?? "—"} – ${x.meterTo ?? "—"}`} />)}
        <Text variant="label">Ture</Text>
        {detail.auto.hauls.map((x) => <ListItem key={x.haulId} title={`${x.machineName}: ${x.material ?? "—"}`} meta={`${x.quantity} ${x.quantityUnit}; faza ${x.phaseId ?? "—"}`} />)}
        <Text variant="label">Kvarovi</Text>
        {detail.auto.faults.map((x) => <ListItem key={x.faultId} title={x.title} meta={`${x.machineName}; ${x.priority}; zastoj ${x.downtimeMinutes ?? "—"} min`} />)}
        <Text>Ukupno sati radnika: {detail.auto.workedHours}</Text>
        <Text variant="label">Upisane količine</Text>
        {detail.items.map((x) => <ListItem key={x.id} title={x.description} meta={`${x.quantity} ${x.unit}`} />)}
      </> : <Text variant="muted">Nema lokalnog presjeka za ovaj dan.</Text>}
    </CardView>
    <CardView>
      <Text variant="label">Vrijeme</Text>
      {WEATHER.map((w) => <Button key={w.value} label={`${weather === w.value ? "✓ " : ""}${w.label}`}
        variant={weather === w.value ? "primary" : "secondary"} onPress={() => setWeather(w.value)} />)}
      <TextField label="Temperatura °C" value={temperature} onChangeText={setTemperature} keyboardType="decimal-pad" />
      <TextField label="Radni sati" value={hours} onChangeText={setHours} keyboardType="decimal-pad" />
      <TextField label="Opis radova" value={description} onChangeText={setDescription} multiline />
      <TextField label="Posjetioci" value={visitors} onChangeText={setVisitors} multiline />
      <TextField label="Posebni događaji" value={events} onChangeText={setEvents} multiline />
      <Text variant="label">Zastoj (opcionalno)</Text>
      <TextField label="Zastoj od (ISO s vremenskom zonom)" value={delayFrom} onChangeText={setDelayFrom} autoCapitalize="none" />
      <TextField label="Zastoj do (ISO s vremenskom zonom)" value={delayTo} onChangeText={setDelayTo} autoCapitalize="none" />
      <TextField label="Sati zastoja" value={delayHours} onChangeText={setDelayHours} keyboardType="decimal-pad" />
      <TextField label="Napomena zastoja" value={delayNote} onChangeText={setDelayNote} />
      <Button label="Sačuvaj nacrt na telefon" busy={busy} onPress={() => void save()} />
      <Button label="Pošalji sada" variant="secondary" busy={busy} onPress={() => void send()} />
    </CardView>
    <CardView>
      <Text variant="label">Ručna količina za već otvoreni dan</Text>
      <TextField label="Opis količine" value={itemDescription} onChangeText={setItemDescription} />
      <TextField label="Jedinica" value={itemUnit} onChangeText={setItemUnit} />
      <TextField label="Količina" value={itemQuantity} onChangeText={setItemQuantity} keyboardType="decimal-pad" />
      <Button label="Sačuvaj količinu na telefon" variant="secondary" busy={busy} onPress={() => void saveItem()} />
    </CardView>
    <CardView>
      <Text variant="label">Potpis šefa</Text>
      <Text>Prije potpisa pregledaj sačuvani sadržaj, sve stavke i automatski presjek iznad. Potpis nije poslan dok sync ne uspije.</Text>
      <TextField label="Ime i prezime potpisnika" value={signedName} onChangeText={setSignedName} />
      <Button label="Potpiši prikazani presjek" busy={busy} onPress={() => void sign()} />
    </CardView>
    {message ? <Text>{message}</Text> : null}
    {entries.slice(0, 10).map((entry) => <ListItem key={entry.localId}
      title={entry.status === "sent" ? "Poslano" : entry.status === "rejected" ? "Odbijeno" : entry.status === "conflict" ? "Sukob — provjeri" : "Čeka slanje"}
      meta={entry.lastError ?? entry.createdAt} />)}
  </Screen>;
}

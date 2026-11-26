/** F9: toolbox zapis se čuva offline; svaki potpis je zasebna radnja i vrijeme. */
import { useCallback, useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import { calendarDateFromLocalDate } from "@gradix/domain";
import { myProjects, pullForemanWorkers } from "../../api/client";
import { getActiveLocalAccount, queueHseTraining, readForemanWorkerRoster, readOutboxEntries,
  saveForemanWorkerRoster, type LocalForemanWorker, type LocalOutboxEntry } from "../../db/r4-outbox";
import { openDb, readProjects, saveProjects, type LocalProject } from "../../db/sqlite";
import { runSqliteR4Sync } from "../../sync/r4-sqlite";
import { sendResultMessage, syncBannerText } from "../../teren/outcome";
import { Banner, Button, CardView, ListItem, Screen, Segmented, Text, TextField } from "../../ui";

type Signature = { workerId: string; signatureName: string; signedAt: string };

export default function ToolboxScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState(() => calendarDateFromLocalDate(new Date()));
  const [workers, setWorkers] = useState<LocalForemanWorker[]>([]);
  const [signatures, setSignatures] = useState<Record<string, Signature>>({});
  const [topic, setTopic] = useState("");
  const [duration, setDuration] = useState("15");
  const [entries, setEntries] = useState<LocalOutboxEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const saving = useRef(false);
  // Stariji odgovor mreže ne smije zamijeniti ekipu drugog projekta.
  const rosterRequest = useRef(0);

  const load = useCallback(async () => {
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      const local = await readProjects(db);
      setProjects(local.rows);
      setEntries(await readOutboxEntries(db, account));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lokalni podaci nisu dostupni.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function refreshProjects() {
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      const response = await myProjects();
      const current = await getActiveLocalAccount(db);
      if (current?.companyId !== account.companyId || current?.userId !== account.userId) {
        throw new Error("Nalog se promijenio tokom osvježavanja.");
      }
      const rows = response.projects.map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status,
        sitePlace: p.sitePlace, startsOn: p.startsOn, endsOn: p.endsOn }));
      await saveProjects(db, rows, new Date().toISOString());
      setProjects(rows);
      setMessage(rows.length ? "Projekti su osvježeni." : "Nema dodijeljenih projekata.");
    } catch { setMessage("Projekti nisu osvježeni; ostaje zadnja lokalna lista."); }
    finally { setBusy(false); }
  }

  async function loadRoster(project: string, workDate: string) {
    const request = ++rosterRequest.current;
    setWorkers([]);
    setSignatures({});
    if (!project) return;
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      let offline = false;
      try {
        const remote = await pullForemanWorkers(project, workDate);
        await saveForemanWorkerRoster(db, account, project, workDate, remote.workers);
      } catch { offline = true; }
      const cached = await readForemanWorkerRoster(db, account, project, workDate);
      if (request !== rosterRequest.current) return;
      setWorkers(cached.workers);
      setMessage(offline ? "Ekipa se nije mogla osvježiti; prikazan je samo keš za ovaj projekat i datum." : null);
    } catch (caught) {
      if (request === rosterRequest.current) setMessage(caught instanceof Error ? caught.message : "Ekipa nije dostupna.");
    }
  }

  async function save() {
    if (saving.current) return;
    const attendees = Object.values(signatures);
    const minutes = Number(duration);
    if (!projectId || topic.trim().length < 3 || attendees.length === 0 || !/^\d+$/.test(duration) || minutes < 1 || minutes > 600) {
      setMessage("Izaberi projekat, temu (najmanje 3 znaka), trajanje 1–600 minuta i najmanje jedan potpis.");
      return;
    }
    if (date !== calendarDateFromLocalDate(new Date())) {
      setMessage("Toolbox se može potpisati samo za današnju ekipu; osvježi datum i potpise.");
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      await queueHseTraining(db, account, { trainingId: `hst_${randomUUID()}`, training: {
        kind: "TOOLBOX", title: topic.trim(), topic: topic.trim(), heldAt: new Date().toISOString(), projectId,
        location: null, durationMinutes: minutes, attendees,
      } });
      setTopic("");
      setSignatures({});
      setMessage("Toolbox je sačuvan na telefonu, još nije poslan.");
      await load();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Toolbox nije sačuvan."); }
    finally { saving.current = false; setBusy(false); }
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
    } catch { setSyncFailed(true); setMessage("Slanje nije uspjelo; zapisi ostaju na telefonu."); }
    finally { setBusy(false); }
  }

  const pending = entries.filter((entry) => entry.status === "pending" || entry.status === "failed").length;
  const review = entries.filter((entry) => entry.status === "rejected" || entry.status === "conflict").length;
  return <Screen title="Toolbox razgovor" subtitle="Tema, trajanje i pojedinačni potpisi ekipe."
    loading={loading} error={error} empty={null} onRetry={load}>
    <Banner>{syncBannerText({ pending, syncFailed, review })} {pending > 0 && review > 0 ? `${review} zahtijeva provjeru.` : ""}</Banner>
    {!error ? <CardView>
      <Button label="Osvježi projekte" variant="secondary" busy={busy} onPress={() => void refreshProjects()} />
      {projects.length ? <Segmented label="Projekat" value={projectId} onChange={(value) => {
        setProjectId(value); void loadRoster(value, date);
      }} options={projects.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))} />
        : <Text variant="muted">Nema lokalnih projekata. Osvježi ih dok imaš mrežu.</Text>}
      <Text>Ekipa za {date}</Text>
      <Button label="Osvježi današnju ekipu" variant="secondary" busy={busy} onPress={() => {
        const today = calendarDateFromLocalDate(new Date()); setDate(today); void loadRoster(projectId, today);
      }} />
      <TextField label="Tema razgovora" value={topic} onChangeText={setTopic} />
      <TextField label="Trajanje u minutama" value={duration} onChangeText={setDuration} keyboardType="number-pad" />
      <Text variant="muted">Svaki prisutni sam dodiruje svoje ime kao potvrdu prisustva; bilježi se vrijeme dodira.</Text>
      {workers.map((worker) => <Button key={worker.id} variant="secondary"
        label={signatures[worker.id] ? `Ukloni potpis: ${worker.name}` : `Potpis: ${worker.name}`}
        onPress={() => setSignatures((previous) => {
          const next = { ...previous };
          if (next[worker.id]) delete next[worker.id];
          else next[worker.id] = { workerId: worker.id, signatureName: worker.name, signedAt: new Date().toISOString() };
          return next;
        })} />)}
      <Text>Potpisa: {Object.keys(signatures).length}</Text>
      <Button label="Sačuvaj na telefon" busy={busy} onPress={() => void save()} />
      <Button label="Pošalji sada" variant="secondary" busy={busy} onPress={() => void send()} />
    </CardView> : null}
    {message ? <Text>{message}</Text> : null}
    {entries.slice(0, 10).map((entry) => <ListItem key={entry.localId}
      title={entry.status === "sent" ? "Poslano" : entry.status === "rejected" ? "Odbijeno — provjeri s uredom" : entry.status === "conflict" ? "Za provjeru" : "Čeka slanje"}
      meta={entry.lastError ?? entry.createdAt} />)}
  </Screen>;
}

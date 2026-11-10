/**
 * Radnik — "Moj dan" (UI Step 7, odobreni dizajn): vlastiti unos se prvo sprema u lokalni
 * outbox, pa šalje R4 sync-om. Server iz sesije zna čiji je dan (bez workerId u stavci).
 */
import { useCallback, useEffect, useState } from "react";
import { machines, me, myProjects } from "../api/client";
import { getActiveLocalAccount, queueOwnWorkEntry, readOutboxEntries, type LocalOutboxEntry } from "../db/r4-outbox";
import { openDb } from "../db/sqlite";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import { Banner, Button, CardView, ListItem, Screen, Segmented, Text, TextField } from "../ui";
import { outcomeFor, syncBannerText, sendResultMessage } from "../teren/outcome";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function MojDanScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ id: string; code: string; name: string }[]>([]);
  const [machineList, setMachineList] = useState<{ id: string; code: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [machineId, setMachineId] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState(todayIso());
  const [started, setStarted] = useState("07:30");
  const [ended, setEnded] = useState("15:30");
  const [entries, setEntries] = useState<LocalOutboxEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profile, projectData, machineData] = await Promise.all([me(), myProjects(), machines()]);
      void profile;
      setProjects(projectData.projects);
      setMachineList(machineData.machines);
      setProjectId((current) => current || projectData.projects[0]?.id || "");
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
    if (!projectId) { setMessage("Izaberi projekat."); return; }
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      await queueOwnWorkEntry(db, account, {
        kind: "WORK",
        startedAt: `${workDate}T${started}:00+01:00`,
        endedAt: `${workDate}T${ended}:00+01:00`,
        endState: "KNOWN_END",
        projectId,
        machineId,
        note: null,
      });
      setEntries(await readOutboxEntries(db, account));
      setMessage("Sačuvano na telefonu. Pošalji kad bude veze.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unos se nije mogao sačuvati.");
    } finally { setBusy(false); }
  }

  async function send() {
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      const outcome = await runSqliteR4Sync(db, account);
      setEntries(await readOutboxEntries(db, account));
      setSyncFailed(outcome.retry > 0);
      setMessage(sendResultMessage(outcome));
    } catch {
      setMessage("Slanje nije uspjelo. Zapisi ostaju na telefonu.");
    } finally { setBusy(false); }
  }

  return (
    <Screen
      title="Moj dan"
      subtitle="Tvoj radni dan — prvo se sprema na telefon, pa se šalje."
      loading={loading}
      error={error}
      empty={projects.length === 0 ? "Nema dodijeljenih projekata za unos. Obrati se šefu ili uredu." : null}
      onRetry={load}
    >
      <Banner>{syncBannerText({ pending, syncFailed: syncFailed || entries.some((entry) => entry.status === "failed") })}</Banner>

      <CardView>
        <Segmented label="Projekat" value={projectId} onChange={setProjectId}
          options={projects.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))} />
        <Segmented label="Mašina" value={machineId ?? ""} onChange={(v) => setMachineId(v === "" ? null : v)}
          options={[{ value: "", label: "Bez mašine" }, ...machineList.map((machine) => ({ value: machine.id, label: `${machine.code} · ${machine.name}` }))]} />
        <TextField label="Datum (GGGG-MM-DD)" value={workDate} onChangeText={setWorkDate} accessibilityLabel="Datum rada" />
        <TextField label="Početak (HH:MM)" value={started} onChangeText={setStarted} accessibilityLabel="Početak rada" />
        <TextField label="Kraj (HH:MM)" value={ended} onChangeText={setEnded} accessibilityLabel="Kraj rada" />
        <Button label="Sačuvaj na telefon" busy={busy} onPress={save} />
        <Button label="Pošalji sada" busy={busy} onPress={send} />
        {message ? <Text>{message}</Text> : null}
      </CardView>

      <CardView>
        <Text variant="label">Moji zapisi i ishod slanja</Text>
        {entries.length === 0 ? <Text variant="muted">Još nema zapisa na ovom telefonu.</Text> : null}
        {entries.map((entry) => (
          <ListItem key={entry.localId} title={entry.createdAt.slice(0, 10)} right={outcomeFor(entry.status, entry.lastError).label} />
        ))}
      </CardView>
    </Screen>
  );
}

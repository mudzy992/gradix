/**
 * Radnik — "Moj dan" (UI Step 7, odobreni dizajn): vlastiti unos se prvo sprema u lokalni
 * outbox, pa šalje R4 sync-om. Server iz sesije zna čiji je dan (bez workerId u stavci).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { machines, me, myProjects } from "../api/client";
import { getActiveLocalAccount, queueOwnWorkEntry, readOutboxEntries, type LocalOutboxEntry } from "../db/r4-outbox";
import { openDb } from "../db/sqlite";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import { TerenShell, createStyles } from "../teren/TerenShell";
import { outcomeFor, syncBannerText } from "../teren/outcome";
import { useTheme } from "../theme/use-theme";
import { jedanStil } from "../lib/styles";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function MojDanScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
      setMessage(outcome.error
        ? "Nema veze sa serverom. Zapisi ostaju na telefonu i poslaće se kasnije."
        : `Slanje završeno: poslano ${outcome.applied + outcome.duplicate}, za provjeru ${outcome.conflict}.`);
    } catch {
      setMessage("Slanje nije uspjelo. Zapisi ostaju na telefonu.");
    } finally { setBusy(false); }
  }

  return (
    <TerenShell
      title="Moj dan"
      subtitle="Tvoj radni dan — prvo se sprema na telefon, pa se šalje."
      loading={loading}
      error={error}
      empty={projects.length === 0 ? "Nema dodijeljenih projekata za unos. Obrati se šefu ili uredu." : null}
      onRetry={load}
    >
      <View style={styles.banner} accessibilityRole="status">
        <Text style={styles.bannerText}>{syncBannerText({ pending, offline: pending > 0 })}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Projekat</Text>
        <View style={styles.chipRow}>
          {projects.map((project) => (
            <Pressable key={project.id} onPress={() => setProjectId(project.id)} accessibilityRole="radio" accessibilityState={{ selected: projectId === project.id }}
              style={jedanStil(styles.chip, projectId === project.id ? styles.chipOn : styles.chip)}>
              <Text style={styles.chipText}>{project.code} · {project.name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>Mašina</Text>
        <View style={styles.chipRow}>
          <Pressable onPress={() => setMachineId(null)} accessibilityRole="radio" accessibilityState={{ selected: machineId === null }}
            style={jedanStil(styles.chip, machineId === null ? styles.chipOn : styles.chip)}>
            <Text style={styles.chipText}>Bez mašine</Text>
          </Pressable>
          {machineList.map((machine) => (
            <Pressable key={machine.id} onPress={() => setMachineId(machine.id)} accessibilityRole="radio" accessibilityState={{ selected: machineId === machine.id }}
              style={jedanStil(styles.chip, machineId === machine.id ? styles.chipOn : styles.chip)}>
              <Text style={styles.chipText}>{machine.code} · {machine.name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>Datum (GGGG-MM-DD)</Text>
        <TextInput style={styles.input} value={workDate} onChangeText={setWorkDate} accessibilityLabel="Datum rada" />
        <Text style={styles.label}>Početak (HH:MM)</Text>
        <TextInput style={styles.input} value={started} onChangeText={setStarted} accessibilityLabel="Početak rada" />
        <Text style={styles.label}>Kraj (HH:MM)</Text>
        <TextInput style={styles.input} value={ended} onChangeText={setEnded} accessibilityLabel="Kraj rada" />
        <Pressable style={styles.button} onPress={save} disabled={busy} accessibilityRole="button">
          <Text style={styles.buttonText}>{busy ? "Radim…" : "Sačuvaj na telefon"}</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={send} disabled={busy} accessibilityRole="button">
          <Text style={styles.buttonText}>Pošalji sada</Text>
        </Pressable>
        {message ? <Text style={styles.text} accessibilityRole="status">{message}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Moji zapisi i ishod slanja</Text>
        {entries.length === 0 ? <Text style={styles.muted}>Još nema zapisa na ovom telefonu.</Text> : null}
        {entries.map((entry) => (
          <View key={entry.localId} style={styles.row}>
            <Text style={styles.rowText}>{entry.createdAt.slice(0, 10)}</Text>
            <Text style={styles.outcome}>{outcomeFor(entry.status, entry.lastError).label}</Text>
          </View>
        ))}
      </View>
    </TerenShell>
  );
}

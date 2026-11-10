/**
 * Šef — "Grupa" (UI Step 7, ODOBRENI dizajn; GLAVNI tok: 1 šef · 5 radnika).
 * Izbor radnika iz R3 opsega (server roster), zajednički projekat i mašina, vremena za sve
 * uz pojedinačna odstupanja, stanje slanja i ishod PO RADNIKU. Van opsega se prikazuje kao
 * "Van opsega — ostaje na telefonu", nikad kao odbijeno.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { machines, myProjects, pullForemanWorkers } from "../api/client";
import {
  getActiveLocalAccount, queueForemanGroupWorkEntries, readForemanWorkerRoster,
  readOutboxEntries, saveForemanWorkerRoster, type LocalOutboxEntry,
} from "../db/r4-outbox";
import { openDb } from "../db/sqlite";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import { TerenShell, createStyles } from "../teren/TerenShell";
import { outcomeFor, syncBannerText } from "../teren/outcome";
import { useTheme } from "../theme/use-theme";
import { jedanStil } from "../lib/styles";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function GrupaScreen() {
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
  const [workers, setWorkers] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, { started: string; ended: string }>>({});
  const [entries, setEntries] = useState<LocalOutboxEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRoster = useCallback(async (project: string, date: string) => {
    const db = await openDb();
    const account = await getActiveLocalAccount(db);
    if (!account || !project) return;
    try {
      const roster = await pullForemanWorkers(project, date);
      await saveForemanWorkerRoster(db, account, project, date, roster.workers);
    } catch {
      // Offline: ostaje zadnji preuzet roster sa telefona (server opseg ponovo provjerava pri slanju).
    }
    const cached = await readForemanWorkerRoster(db, account, project, date);
    setWorkers(cached.workers);
    setSelected(new Set(cached.workers.map((worker) => worker.id)));
    setEntries(await readOutboxEntries(db, account));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectData, machineData] = await Promise.all([myProjects(), machines()]);
      setProjects(projectData.projects);
      setMachineList(machineData.machines);
      const first = projectData.projects[0]?.id ?? "";
      setProjectId((current) => current || first);
      await loadRoster(first, workDate);
    } catch {
      setError("Podaci se nisu mogli učitati. Provjeri vezu i pokušaj ponovo.");
    } finally {
      setLoading(false);
    }
    // workDate je početni datum ekrana; promjena datuma ide kroz dugme Osvježi ekipu.
  }, [loadRoster]);

  useEffect(() => { void load(); }, [load]);

  const pending = entries.filter((entry) => entry.status === "pending" || entry.status === "failed").length;
  const latestByWorker = useMemo(() => {
    const map = new Map<string, LocalOutboxEntry>();
    for (const entry of entries) {
      if (entry.workerId && !map.has(entry.workerId)) map.set(entry.workerId, entry);
    }
    return map;
  }, [entries]);

  function toggleWorker(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function saveGroup() {
    const chosen = workers.filter((worker) => selected.has(worker.id));
    if (!projectId || chosen.length === 0) { setMessage("Izaberi projekat i najmanje jednog radnika."); return; }
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      // Zajednička vremena za sve; pojedinačno odstupanje radnika ima prednost.
      for (const worker of chosen) {
        const override = overrides[worker.id];
        await queueForemanGroupWorkEntries(db, account, {
          projectId,
          workDate,
          workerIds: [worker.id],
          entry: {
            kind: "WORK",
            startedAt: `${workDate}T${override?.started || started}:00+01:00`,
            endedAt: `${workDate}T${override?.ended || ended}:00+01:00`,
            endState: "KNOWN_END",
            projectId,
            machineId,
            note: null,
          },
        });
      }
      setEntries(await readOutboxEntries(db, account));
      setMessage(`Sačuvano na telefonu za ${chosen.length} radnika. Pošalji kad bude veze.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Grupni unos se nije mogao sačuvati.");
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
        : `Slanje završeno: poslano ${outcome.applied + outcome.duplicate}, za provjeru ${outcome.conflict}. Ishod po radniku je ispod.`);
    } catch {
      setMessage("Slanje nije uspjelo. Zapisi ostaju na telefonu.");
    } finally { setBusy(false); }
  }

  return (
    <TerenShell
      title="Grupa"
      subtitle="Grupni unos za tvoju ekipu — jedan unos, ishod za svakog radnika."
      loading={loading}
      error={error}
      empty={workers.length === 0 ? "Nema radnika u tvom opsegu za ovaj projekat i datum." : null}
      onRetry={load}
    >
      <View style={styles.banner} accessibilityRole="status">
        <Text style={styles.bannerText}>{syncBannerText({ pending, offline: pending > 0 })}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Zajednički projekat</Text>
        <View style={styles.chipRow}>
          {projects.map((project) => (
            <Pressable key={project.id} onPress={() => { setProjectId(project.id); void loadRoster(project.id, workDate); }}
              accessibilityRole="radio" accessibilityState={{ selected: projectId === project.id }}
              style={jedanStil(styles.chip, projectId === project.id ? styles.chipOn : styles.chip)}>
              <Text style={styles.chipText}>{project.code} · {project.name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>Zajednička mašina</Text>
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
        <Pressable style={styles.button} onPress={() => void loadRoster(projectId, workDate)} accessibilityRole="button">
          <Text style={styles.buttonText}>Osvježi ekipu za datum</Text>
        </Pressable>
        <Text style={styles.label}>Početak za sve (HH:MM)</Text>
        <TextInput style={styles.input} value={started} onChangeText={setStarted} accessibilityLabel="Početak za sve" />
        <Text style={styles.label}>Kraj za sve (HH:MM)</Text>
        <TextInput style={styles.input} value={ended} onChangeText={setEnded} accessibilityLabel="Kraj za sve" />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Radnici iz opsega ({selected.size}/{workers.length} izabrano)</Text>
        {workers.map((worker) => {
          const latest = latestByWorker.get(worker.id);
          const override = overrides[worker.id];
          return (
            <View key={worker.id}>
              <View style={styles.row}>
                <Pressable onPress={() => toggleWorker(worker.id)} accessibilityRole="checkbox" accessibilityState={{ checked: selected.has(worker.id) }}
                  style={jedanStil(styles.chip, selected.has(worker.id) ? styles.chipOn : styles.chip)}>
                  <Text style={styles.chipText}>{selected.has(worker.id) ? "✓" : " "}</Text>
                </Pressable>
                <Text style={styles.rowText}>{worker.name}</Text>
                <Text style={styles.outcome}>{latest ? outcomeFor(latest.status, latest.lastError).label : "Nije poslano"}</Text>
              </View>
              <TextInput
                style={styles.input}
                value={override ? `${override.started}-${override.ended}` : ""}
                placeholder={`${started}-${ended} (zajedničko)`}
                onChangeText={(value) => {
                  const [start, end] = value.split("-");
                  if (start && end) setOverrides((current) => ({ ...current, [worker.id]: { started: start, ended: end } }));
                  if (!value) setOverrides((current) => { const next = { ...current }; delete next[worker.id]; return next; });
                }}
                accessibilityLabel={`Pojedinačno vrijeme za ${worker.name}`}
              />
            </View>
          );
        })}
        <Pressable style={styles.button} onPress={saveGroup} disabled={busy} accessibilityRole="button">
          <Text style={styles.buttonText}>{busy ? "Radim…" : `Sačuvaj za ${selected.size} radnika`}</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={send} disabled={busy} accessibilityRole="button">
          <Text style={styles.buttonText}>Pošalji sada</Text>
        </Pressable>
        {message ? <Text style={styles.text} accessibilityRole="status">{message}</Text> : null}
      </View>
    </TerenShell>
  );
}

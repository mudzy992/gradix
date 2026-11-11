/**
 * Šef — "Grupa" (UI Step 7, ODOBRENI dizajn; GLAVNI tok: 1 šef · 5 radnika).
 * Izbor radnika iz R3 opsega (server roster), zajednički projekat i mašina, vremena za sve
 * uz pojedinačna odstupanja, stanje slanja i ishod PO RADNIKU. Van opsega se prikazuje kao
 * "Van opsega — ostaje na telefonu", nikad kao odbijeno.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { machines, myProjects, pullForemanWorkers } from "../api/client";
import {
  getActiveLocalAccount, queueForemanGroupWorkEntries, readForemanWorkerRoster,
  readOutboxEntries, saveForemanWorkerRoster, type LocalOutboxEntry,
} from "../db/r4-outbox";
import { openDb } from "../db/sqlite";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import { Banner, Button, CardView, CheckboxRow, Screen, Segmented, Text, TextField } from "../ui";
import { outcomeFor, syncBannerText, sendResultMessage, OUT_OF_SCOPE_NOTE } from "../teren/outcome";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function GrupaScreen() {
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
  const [syncFailed, setSyncFailed] = useState(false);

  const loadRoster = useCallback(async (project: string, date: string) => {
    const db = await openDb();
    const account = await getActiveLocalAccount(db);
    if (!account || !project) return;
    let pullFailed = false;
    try {
      const roster = await pullForemanWorkers(project, date);
      await saveForemanWorkerRoster(db, account, project, date, roster.workers);
    } catch {
      // Offline: ostaje zadnji preuzet roster sa telefona (server opseg ponovo provjerava pri slanju).
      pullFailed = true;
    }
    const cached = await readForemanWorkerRoster(db, account, project, date);
    if (pullFailed && cached.workers.length === 0) {
      // Ne glumi prazan opseg kad preuzimanje nije uspjelo (nema mreže ili nema dodjele):
      // prazan keš + neuspjeo poziv nije isto što i prazna ekipa.
      setMessage("Ekipa se nije mogla preuzeti (mreža ili dodjela na projektu). Pokušaj dugme „Osvježi ekipu za datum“.");
    }
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
      setSyncFailed(outcome.retry > 0);
      setMessage(`${sendResultMessage(outcome)} Ishod po radniku je ispod.`);
    } catch {
      setMessage("Slanje nije uspjelo. Zapisi ostaju na telefonu.");
    } finally { setBusy(false); }
  }

  return (
    <Screen
      title="Grupa"
      subtitle="Grupni unos za tvoju ekipu — jedan unos, ishod za svakog radnika."
      loading={loading}
      error={error}
      empty={workers.length === 0 ? "Nema radnika u tvom opsegu za ovaj projekat i datum." : null}
      onRetry={load}
    >
      <Banner>{syncBannerText({ pending, syncFailed: syncFailed || entries.some((entry) => entry.status === "failed") })}</Banner>

      <CardView>
        <Segmented
          label="Zajednički projekat"
          value={projectId}
          onChange={(value) => { setProjectId(value); void loadRoster(value, workDate); }}
          options={projects.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))}
        />
        <Segmented
          label="Zajednička mašina"
          value={machineId ?? ""}
          onChange={(value) => setMachineId(value === "" ? null : value)}
          options={[{ value: "", label: "Bez mašine" }, ...machineList.map((machine) => ({ value: machine.id, label: `${machine.code} · ${machine.name}` }))]}
        />
        <TextField label="Datum (GGGG-MM-DD)" value={workDate} onChangeText={setWorkDate} accessibilityLabel="Datum rada" />
        <Button label="Osvježi ekipu za datum" variant="secondary" onPress={() => void loadRoster(projectId, workDate)} />
        <TextField label="Početak za sve (HH:MM, 24 h)" value={started} onChangeText={setStarted} accessibilityLabel="Početak za sve" />
        <TextField label="Kraj za sve (HH:MM, 24 h)" value={ended} onChangeText={setEnded} accessibilityLabel="Kraj za sve" />
      </CardView>

      <CardView>
        <Text variant="label">Radnici iz opsega ({selected.size}/{workers.length} izabrano)</Text>
        {workers.map((worker) => {
          const latest = latestByWorker.get(worker.id);
          const override = overrides[worker.id];
          return (
            <Fragment key={worker.id}>
              <CheckboxRow
                label={worker.name}
                checked={selected.has(worker.id)}
                onToggle={() => toggleWorker(worker.id)}
                right={latest ? outcomeFor(latest.status, latest.lastError).label : "Nije poslano"}
              />
              <TextField
                label={`Pojedinačno vrijeme za ${worker.name}`}
                value={override ? `${override.started}-${override.ended}` : ""}
                placeholder={`${started}-${ended} (zajedničko)`}
                onChangeText={(value) => {
                  const [start, end] = value.split("-");
                  if (start && end) setOverrides((current) => ({ ...current, [worker.id]: { started: start, ended: end } }));
                  if (!value) setOverrides((current) => { const next = { ...current }; delete next[worker.id]; return next; });
                }}
                accessibilityLabel={`Pojedinačno vrijeme za ${worker.name}`}
              />
            </Fragment>
          );
        })}
        <Text variant="muted">{OUT_OF_SCOPE_NOTE}</Text>
        <Button label={`Sačuvaj za ${selected.size} radnika`} busy={busy} onPress={saveGroup} />
        <Button label="Pošalji sada" busy={busy} onPress={send} />
        {message ? <Text>{message}</Text> : null}
      </CardView>
    </Screen>
  );
}

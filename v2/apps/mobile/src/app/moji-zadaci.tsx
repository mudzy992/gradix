/**
 * „Moji zadaci danas“ (F5, spec 06 §1.6.25 / §4).
 *
 * Zašto poseban ekran, kad postoji `/ured/zadaci`: na terenu se ne pita „svi zadaci“, nego „šta
 * imam danas“. Jedan zahtjev (`assignee=ME&due=TODAY`), jedna lista, bez filtera koje treba
 * pamtiti. Kasni zadaci su ISTAKNUTI u istoj listi — čovjek koji vidi samo današnje ne vidi ono
 * što je od juče ostalo.
 *
 * Dodirne mete su ≥ 56 dp (`touchTarget`): telefon je u rukavici. Red je jedna meta — stanje se
 * mijenja dodirom na red, ne kroz meni.
 */
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { updateTask, myTasksToday, type TaskListResponse, type TaskRow, type TaskStatus } from "../api/client";
import { AlertBox, Button, CardView, ListItem, Screen, StatusChip, Text } from "../ui";

const STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: "Otvoren",
  IN_PROGRESS: "U toku",
  BLOCKED: "Blokiran",
  DONE: "Završen",
  CANCELLED: "Otkazan",
};

const PRIORITY_LABEL: Record<TaskRow["priority"], string> = {
  LOW: "nizak",
  NORMAL: "normalan",
  HIGH: "visok",
  URGENT: "hitno",
};

/** Sljedeće stanje pri dodiru: otvoren → u toku → završen. Ostala stanja se ne diraju dodirom. */
export function nextStatus(status: TaskStatus): TaskStatus | null {
  if (status === "OPEN") return "IN_PROGRESS";
  if (status === "IN_PROGRESS") return "DONE";
  return null;
}

export function taskMeta(task: TaskRow): string {
  const parts = [STATUS_LABEL[task.status], `prioritet ${PRIORITY_LABEL[task.priority]}`];
  if (task.project_code) parts.push(task.project_code);
  if (task.overdue) parts.push("kasni");
  if (task.comment_count > 0) parts.push(`${task.comment_count} kom.`);
  return parts.join(" · ");
}

export default function MojiZadaciScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TaskListResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setData((await myTasksToday()) as TaskListResponse);
    } catch {
      setError("Zadaci nisu učitani. Provjerite vezu i pokušajte ponovo.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function advance(task: TaskRow) {
    const next = nextStatus(task.status);
    if (!next) return;
    setBusyId(task.id);
    setMessage(null);
    try {
      await updateTask(task.id, { status: next });
      setMessage(`${task.title} → ${STATUS_LABEL[next].toLowerCase()}.`);
      await load();
    } catch {
      // Bez mreže stanje ostaje kakvo jeste; ekran NE prikazuje lažni uspjeh.
      setMessage("Promjena nije poslana. Provjerite vezu — zadatak je ostao u istom stanju.");
    } finally {
      setBusyId(null);
    }
  }

  const tasks = data?.tasks ?? [];
  const today = tasks.filter((task) => task.status !== "DONE" && task.status !== "CANCELLED");

  return (
    <Screen
      title="Moji zadaci danas"
      subtitle={
        data
          ? `${today.length} otvoreno za danas · ${data.counts.overdue} kasni ukupno`
          : "Zadaci dodijeljeni meni za današnji dan."
      }
      loading={loading}
      error={error}
      empty={!loading && !error && today.length === 0 ? "Za danas nemate otvorenih zadataka." : null}
      onRetry={() => void load()}
    >
      <View>
        {message ? <AlertBox>{message}</AlertBox> : null}

        {today.map((task) => {
          const next = nextStatus(task.status);
          return (
            <CardView key={task.id}>
              <ListItem
                title={task.title}
                meta={taskMeta(task)}
                right={task.overdue ? "KASNI" : undefined}
              />
              {task.description ? <Text variant="muted">{task.description}</Text> : null}
              {task.overdue ? (
                <StatusChip label="rok prošao" tone="danger" />
              ) : (
                <StatusChip label={STATUS_LABEL[task.status]} tone={task.status === "BLOCKED" ? "warn" : "plain"} />
              )}
              {next ? (
                <Button
                  label={next === "IN_PROGRESS" ? "Počni" : "Završi"}
                  onPress={() => void advance(task)}
                  disabled={busyId === task.id}
                />
              ) : null}
            </CardView>
          );
        })}

        {tasks.length > 0 && today.length === 0 ? (
          <View>
            <Text variant="muted">Svi današnji zadaci su završeni.</Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

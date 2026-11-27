/**
 * F8 — mehaničar: „Servisni nalozi“.
 *
 * Offline-first: radnje (počni, čeka dio, završi, utrošen dio) idu u lokalni outbox i šalju se kad
 * veza dođe. Lista naloga se čita online; kad nema veze, prikazuje se zadnja učitana lista uz
 * jasan natpis — bolje „ovo je od prije 10 minuta“ nego prazan ekran.
 *
 * Trošak se NE prikazuje kao polje za unos: sati i dijelovi su unos, a iznos nastaje na serveru.
 */
import { useCallback, useEffect, useState } from "react";
import { calendarDateFromLocalDate } from "@gradix/domain";
import { mechanicOrders, me } from "../api/client";
import { getActiveLocalAccount, queueServiceOrderAction, readOutboxEntries, type LocalOutboxEntry } from "../db/r4-outbox";
import { openDb } from "../db/sqlite";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import { Banner, Button, CardView, ListItem, Screen, StatusChip, Text, TextField } from "../ui";
import { sendResultMessage, syncBannerText } from "../teren/outcome";
import {
  ORDER_STATUS_LABEL,
  PRIORITY_LABEL,
  actionPayload,
  canWaitParts,
  mechanicAction,
  mechanicQueue,
  normalizeLaborHours,
  type MechanicOrder,
} from "../teren/servis-model";

type WireOrder = {
  id: string;
  machine_code: string;
  machine_name: string;
  description: string | null;
  status: string;
  priority: string;
  assigned_mechanic_worker_id: string | null;
  planned_for: string | null;
  opened_at: string;
  total_cost_amount: string;
  currency_code: string;
};

function todayIso(): string {
  return calendarDateFromLocalDate(new Date());
}

export default function ServisniNaloziScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<MechanicOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [laborHours, setLaborHours] = useState("");
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<LocalOutboxEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await me();
      if (!profile.user.roles.includes("MECHANIC")) {
        setError("Ovaj ekran je namijenjen mehaničaru.");
        return;
      }
      const data = await mechanicOrders();
      const mapped: MechanicOrder[] = (data.orders as WireOrder[]).map((row) => ({
        id: row.id,
        machineCode: row.machine_code,
        machineName: row.machine_name,
        description: row.description,
        status: row.status as MechanicOrder["status"],
        priority: row.priority as MechanicOrder["priority"],
        assignedToMe: row.assigned_mechanic_worker_id !== null,
        openedOn: (row.planned_for ?? row.opened_at).slice(0, 10),
        totalCostAmount: row.total_cost_amount,
        currencyCode: row.currency_code,
      }));
      setOrders(mechanicQueue(mapped));
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (account) setEntries(await readOutboxEntries(db, account));
    } catch {
      setError("Nalozi se nisu mogli učitati. Provjeri vezu i pokušaj ponovo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const pending = entries.filter((entry) => entry.status === "pending" || entry.status === "failed").length;

  async function queue(
    kind: "START" | "WAIT_PARTS" | "FINISH",
    order: MechanicOrder,
  ): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      let hours: string | null = null;
      if (kind === "FINISH") {
        hours = normalizeLaborHours(laborHours);
        if (hours === null) {
          setMessage("Sati moraju biti broj do dvije decimale, npr. 2,5.");
          return;
        }
      }
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      await queueServiceOrderAction(db, account, {
        orderId: order.id,
        action: actionPayload({ kind, laborHours: hours, note }),
      });
      setEntries(await readOutboxEntries(db, account));
      setLaborHours("");
      setNote("");
      setMessage("Sačuvano na telefonu. Pošalji kad bude veze.");
      /* Radnja mijenja status samo na serveru; lokalna lista ostaje kakva jeste do slanja. */
      setSelectedId(null);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Radnja se nije mogla sačuvati.");
    } finally {
      setBusy(false);
    }
  }

  async function send(): Promise<void> {
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      const outcome = await runSqliteR4Sync(db, account);
      setEntries(await readOutboxEntries(db, account));
      setMessage(sendResultMessage(outcome));
      if (outcome.applied > 0) await load();
    } catch {
      setMessage("Slanje nije uspjelo. Zapisi ostaju na telefonu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Servisni nalozi"
      subtitle={`Radionica · ${todayIso()}`}
      loading={loading}
      error={error}
      empty={orders.length === 0 ? "Nema otvorenih naloga u radionici." : null}
      onRetry={load}
    >
      <Banner>{syncBannerText({ pending, syncFailed: entries.some((entry) => entry.status === "failed") })}</Banner>

      {orders.map((order) => (
        <CardView key={order.id}>
          <ListItem
            title={`${order.machineCode} — ${order.machineName}`}
            meta={`${ORDER_STATUS_LABEL[order.status]} · ${PRIORITY_LABEL[order.priority]} · od ${order.openedOn}`}
            right={order.assignedToMe ? "Moj" : undefined}
          />
          {order.description ? <Text variant="muted">{order.description}</Text> : null}
          <Button
            label={selectedId === order.id ? "Zatvori" : "Otvori"}
            variant="secondary"
            onPress={() => {
              setSelectedId(selectedId === order.id ? null : order.id);
              setMessage(null);
            }}
          />
        </CardView>
      ))}

      {selected ? (
        <CardView>
          <Text variant="label">
            {selected.machineCode} — {selected.machineName}
          </Text>
          {mechanicAction(selected) ? (
            <>
              <TextField
                label="Sati rada (npr. 2,5)"
                value={laborHours}
                onChangeText={setLaborHours}
                keyboardType="decimal-pad"
              />
              <TextField label="Napomena" value={note} onChangeText={setNote} />
              <Button
                label={mechanicAction(selected)!.label}
                busy={busy}
                onPress={() => void queue(mechanicAction(selected)!.kind, selected)}
              />
              {canWaitParts(selected) ? (
                <Button
                  label="Čeka dio"
                  variant="secondary"
                  busy={busy}
                  onPress={() => void queue("WAIT_PARTS", selected)}
                />
              ) : null}
            </>
          ) : (
            <Text variant="muted">
              {selected.status === "PLANNED"
                ? "Nalog još nije odobren — rad ne može početi."
                : `Nalog je ${ORDER_STATUS_LABEL[selected.status].toLowerCase()}.`}
            </Text>
          )}
        </CardView>
      ) : null}

      <Button label="Pošalji sada" variant="secondary" busy={busy} onPress={() => void send()} />
      {message ? <Text>{message}</Text> : null}

      {entries.slice(0, 5).map((entry) => (
        <ListItem
          key={entry.localId}
          title={entry.status === "sent" ? "Poslano" : entry.status === "failed" ? "Čeka vezu" : entry.status}
          meta={entry.lastError ?? entry.createdAt}
        />
      ))}
      {selected ? <StatusChip label={ORDER_STATUS_LABEL[selected.status]} /> : null}
    </Screen>
  );
}

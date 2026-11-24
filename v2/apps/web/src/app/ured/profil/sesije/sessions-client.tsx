"use client";

/**
 * Moje sesije / moji uređaji (spec 01 §1.6.28).
 *
 * Šta ekran namjerno radi:
 *   - **„Ovo je ovaj uređaj“** postoji uvijek, i to po ID-u sesije (ne po UA): dvije iste
 *     oznake „Windows · Chrome“ inače izgledaju identično, a jedna je telefon u drugom gradu;
 *   - **tekući uređaj se ne može opozvati** ovdje — za to je „Odjava“, inače bi korisnik
 *     ostao na ekranu bez sesije i sa porukom „sesija nije pronađena“;
 *   - **„Odjavi sve ostale“** je odvojeno dugme sa potvrdom, jer je to jedina radnja koja
 *     izbacuje ljude i sa terena.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall } from "@/api-client";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Skeleton,
  Stack,
  type DataColumn,
} from "@/components/ui/index";

type Session = {
  id: string;
  deviceLabel: string;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
};

const dateFormat = new Intl.DateTimeFormat("bs-BA", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function SessionsClient() {
  const [rows, setRows] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await apiCall<{ sessions: Session[] }>("/api/me/sessions");
    if (result.ok) {
      setRows(result.data.sessions);
      setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    setBusy(true);
    const result = await apiCall<{ revoked: number }>(`/api/me/sessions/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice("Uređaj je odjavljen. Ako je bio tuđi, više ne može otvoriti aplikaciju.");
    void load();
  };

  const revokeOthers = async () => {
    setBusy(true);
    const result = await apiCall<{ revoked: number }>("/api/me/sessions/revoke-others", { method: "POST" });
    setBusy(false);
    setConfirmOthers(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(
      result.data.revoked === 0
        ? "Nema drugih uređaja — prijavljeni ste samo ovdje."
        : `Odjavljeno uređaja: ${result.data.revoked}. Ovaj uređaj ostaje prijavljen.`,
    );
    void load();
  };

  const columns: DataColumn<Session>[] = [
    {
      key: "device",
      header: "Uređaj",
      cell: (row) => (
        <span>
          {row.deviceLabel} {row.isCurrent ? <Badge tone="primary">Ovaj uređaj</Badge> : null}
        </span>
      ),
    },
    { key: "lastSeen", header: "Zadnja aktivnost", cell: (row) => dateFormat.format(new Date(row.lastSeenAt)) },
    { key: "created", header: "Prijava", cell: (row) => dateFormat.format(new Date(row.createdAt)) },
  ];

  const others = rows.filter((row) => !row.isCurrent);

  return (
    <Stack>
      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        {loading ? (
          <Skeleton rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nema aktivnih sesija"
            description="Ovo je neočekivano — osvježite stranicu ili se prijavite ponovo."
          />
        ) : (
          <DataTable
            caption="Moji uređaji"
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            actions={(row) =>
              row.isCurrent
                ? []
                : [{ key: "revoke", label: "Odjavi uređaj", danger: true, onSelect: () => void revoke(row.id) }]
            }
            rowActionLabel={(row) => `Radnje za ${row.deviceLabel}`}
          />
        )}
      </Card>

      <Stack>
        <Button variant="secondary" onClick={() => setConfirmOthers(true)} disabled={busy || others.length === 0}>
          Odjavi sve ostale uređaje
        </Button>
        <p className="gx-muted">
          Odjava važi odmah: opozvana sesija ne može otvoriti ni jedan ekran, čak i ako je na
          telefonu ostao sačuvan token.
        </p>
      </Stack>

      <ConfirmDialog
        open={confirmOthers}
        title="Odjaviti sve ostale uređaje?"
        text="Svi ostali uređaji moraju se ponovo prijaviti. Ovaj uređaj ostaje prijavljen."
        confirmLabel="Odjavi ostale"
        danger
        busy={busy}
        onConfirm={() => void revokeOthers()}
        onCancel={() => setConfirmOthers(false)}
      />
    </Stack>
  );
}

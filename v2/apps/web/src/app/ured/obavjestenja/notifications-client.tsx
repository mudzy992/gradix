"use client";

/**
 * Inbox obavještenja: lista, „pročitaj sve“, filter neproučenih.
 *
 * Tri stvari koje ekran radi namjerno:
 *   - **Sve je link.** Obavještenje bez odredišta je slijepa ulica; `href` je obavezan i u bazi.
 *   - **Neproučeno nije samo boja** — nosi tekst „Novo“ (pristupačnost + čitanje na suncu).
 *   - **Greška čitanja se vidi**, ne pretvara se u praznu listu: prazan inbox je tvrdnja da
 *     nema ničega, a to tada ne znamo.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiCall } from "@/api-client";
import { Alert, Button, Chip, EmptyState, Skeleton } from "@/components/ui/index";

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  createdAt: string;
  readAt: string | null;
};

const dateFormat = new Intl.DateTimeFormat("bs-BA", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function NotificationsClient() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await apiCall<{ notifications: NotificationRow[]; unreadCount: number }>(
      `/api/notifications?limit=50${onlyUnread ? "&unread=1" : ""}`,
    );
    if (result.ok) {
      setRows(result.data.notifications);
      setUnread(result.data.unreadCount);
      setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, [onlyUnread]);

  useEffect(() => {
    void load();
  }, [load]);

  const markAll = async () => {
    const result = await apiCall<{ updated: number }>("/api/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    if (result.ok) void load();
    else setError(result.message);
  };

  const markOne = async (id: string) => {
    const result = await apiCall<{ updated: number }>("/api/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (result.ok) void load();
    else setError(result.message);
  };

  return (
    <div className="gx-stack">
      <div className="gx-page-head">
        <div>
          <h1 className="gx-h1">Obavještenja</h1>
          <p className="gx-muted">
            {unread === 0 ? "Sve je pročitano." : `${unread} neproučenih.`}
          </p>
        </div>
        <div className="gx-row">
          <Button
            variant="quiet"
            onClick={() => setOnlyUnread((value) => !value)}
            aria-pressed={onlyUnread}
          >
            {onlyUnread ? "Prikaži sva" : "Samo neproučena"}
          </Button>
          <Button variant="quiet" onClick={() => void markAll()} disabled={unread === 0}>
            Označi sve kao pročitano
          </Button>
        </div>
      </div>

      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}

      {loading ? (
        <Skeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={onlyUnread ? "Nema neproučenih obavještenja" : "Nema obavještenja"}
          description="Kad nešto zatraži pažnju — rok, budžet, izvještaj — pojavit će se ovdje. In-app poruka se ne isključuje."
        />
      ) : (
        <ul className="gx-list">
          {rows.map((row) => (
            <li key={row.id} className="gx-list__item">
              <div className="gx-row gx-row--between">
                <Link href={row.href} className="gx-link-strong">
                  {row.title}
                </Link>
                <span className="gx-row">
                  {row.severity === "CRITICAL" ? <Chip tone="hot">Kritično</Chip> : null}
                  {!row.readAt ? <Chip tone="full">Novo</Chip> : null}
                </span>
              </div>
              {row.body ? <p className="gx-muted">{row.body}</p> : null}
              <div className="gx-row gx-row--between">
                <time dateTime={row.createdAt} className="gx-small">
                  {dateFormat.format(new Date(row.createdAt))}
                </time>
                {!row.readAt ? (
                  <Button variant="quiet" onClick={() => void markOne(row.id)}>
                    Pročitano
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

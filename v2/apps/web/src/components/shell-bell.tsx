"use client";

/**
 * Zvonce inboxa (F0.4).
 *
 * Broj se čita sa servera (`/api/notifications`), ne broji se u UI-u: in-app je OBAVEZAN kanal,
 * pa ako server ne vrati ništa, zvonce ne smije izmisliti „0“ i time reći da je sve pročitano.
 * Greška čitanja je zato TIHO stanje (bez broja), a ne lažna nula.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiCall } from "@/api-client";
import { Icon } from "./ui/index";

const POLL_MS = 60_000;

export function ShellBell() {
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const result = await apiCall<{ unreadCount: number }>("/api/notifications?limit=1");
      if (!alive) return;
      setUnread(result.ok ? result.data.unreadCount : null);
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <Link
      href="/ured/obavjestenja"
      className="gx-icon-btn gx-bell"
      aria-label={unread ? `Obavještenja, ${unread} neproučenih` : "Obavještenja"}
    >
      <Icon name="bell" />
      {unread !== null && unread > 0 ? (
        <span className="gx-bell__count" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}

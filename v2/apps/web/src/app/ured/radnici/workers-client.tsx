"use client";

/**
 * Radnici — lista (predložak migracije U7b: samo Gradix komponente, bez sirovih elemenata).
 *
 * Pravila koja ekran sprovodi:
 *  - **Radnik nije nalog.** Red prikazuje osobu; veza na nalog je opciona i piše se kao
 *    „Nalog: email“, nikad kao goli id. Bez naloga je uobičajeno stanje, ne greška.
 *  - **Nema brisanja.** Deaktivacija je jedina radnja prekida rada — istorija (angažman,
 *    brojilo mašine koju je vozio) mora ostati čitljiva.
 *  - Jedna kontekstualna akcija po redu („Izmijeni“), ostalo u meniju „⋯“.
 *  - Stanje se nikad ne prenosi samo bojom: chip ima tekst („Aktivan“ / „Neaktivan“).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Worker } from "@gradix/contracts";
import { apiCall, patchBody } from "@/api-client";
import { engagementLabel, formatDate, initialsOf } from "@/format";
import {
  Alert, Button, Card, Checkbox, Chip, DataTable, FilterBar, Inline, Input,
  Mono, PageHeader, Stack,
} from "@/components/ui/index";
import { WorkerDialog } from "./worker-form";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; workers: Worker[] };

export default function WorkersClient({
  canManage,
  canLinkUser,
}: {
  canManage: boolean;
  canLinkUser: boolean;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [filter, setFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState<{ worker: Worker | null; returnTo: HTMLElement | null } | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const result = await apiCall<{ workers: Worker[] }>("/api/workers");
    if (!result.ok) {
      setState({ kind: "error", message: result.message });
      return;
    }
    setState({ kind: "ready", workers: result.data.workers });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const workers = state.kind === "ready" ? state.workers : [];
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return workers.filter((worker) => {
      if (!showInactive && !worker.isActive) return false;
      if (needle.length === 0) return true;
      return `${worker.firstName} ${worker.lastName} ${worker.jobTitle ?? ""} ${worker.team ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [workers, filter, showInactive]);

  const inactiveCount = workers.filter((worker) => !worker.isActive).length;

  async function toggleActive(worker: Worker) {
    try {
      const result = await apiCall<{ worker: Worker }>(
        `/api/workers/${worker.id}/active`,
        patchBody({ active: !worker.isActive }),
      );
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
        return;
      }
      setMessage({
        tone: "success",
        text: worker.isActive
          ? `${worker.firstName} ${worker.lastName} je deaktiviran. Zapis i istorija ostaju.`
          : `${worker.firstName} ${worker.lastName} je ponovo aktivan.`,
      });
      await load();
    } finally {
      // busy stanje po redu nije potrebno: akcija je brza i lista se osvježava nakon nje.
    }
  }

  const addButton = canManage ? (
    <Button
      variant="primary"
      icon="users"
      onClick={(event) => setEditing({ worker: null, returnTo: event.currentTarget })}
    >
      + Dodaj radnika
    </Button>
  ) : null;

  const columns = [
    {
      key: "worker",
      header: "Radnik",
      cell: (worker: Worker) => (
        <Inline>
          <span aria-hidden="true" className="gx-avatar">
            {initialsOf(worker.firstName, worker.lastName)}
          </span>
          <span className="gx-who">
            {worker.firstName} {worker.lastName}
            <span>
              {worker.jobTitle ?? "—"}
              {worker.team ? ` · ${worker.team}` : ""}
            </span>
          </span>
        </Inline>
      ),
    },
    {
      key: "contact",
      header: "Kontakt",
      cell: (worker: Worker) => (
        <Stack>
          <Mono>{worker.phone ?? "—"}</Mono>
          <span>{worker.email ?? "—"}</span>
        </Stack>
      ),
    },
    { key: "engagement", header: "Angažman", cell: (worker: Worker) => engagementLabel(worker.engagement) },
    {
      key: "from",
      header: "Od",
      cell: (worker: Worker) => <Mono>{formatDate(worker.hiredAt)}</Mono>,
    },
    {
      key: "status",
      header: "Status",
      cell: (worker: Worker) => (
        <Stack>
          <Chip tone={worker.isActive ? "full" : "hollow"}>{worker.isActive ? "Aktivan" : "Neaktivan"}</Chip>
          {/* Veza na nalog je podatak, ne status: bez naloga je normalno. */}
          <span>{worker.userEmail ? `Nalog: ${worker.userEmail}` : "Bez naloga"}</span>
        </Stack>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Radnici"
        subtitle="Ljudi na gradilištu, kontakt i angažman. Radnik ne mora imati nalog u aplikaciji."
        actions={addButton}
      />

      {message ? (
        <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </Alert>
      ) : null}

      <Card>
        <FilterBar>
          <Input
            label="Traži radnika"
            id="worker-filter"
            placeholder="Ime, zanimanje ili ekipa"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <Checkbox
            label={`Prikaži i neaktivne (${inactiveCount})`}
            id="worker-show-inactive"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
          />
        </FilterBar>

        <DataTable
          rows={visible}
          columns={columns}
          rowKey={(worker) => worker.id}
          caption="Radnici"
          loading={state.kind === "loading"}
          error={state.kind === "error" ? state.message : null}
          onRetry={() => void load()}
          emptyText={
            workers.length === 0
              ? "Dodajte prvog radnika ili uvezite spisak iz Excela (Uvoz)."
              : showInactive
                ? "Promijenite tekst filtera."
                : "Probajte sa uključenim neaktivnima."
          }
          emptyAction={
            workers.length === 0
              ? (addButton ?? undefined)
              : (
                <Button
                  onClick={() => {
                    setFilter("");
                    setShowInactive(true);
                  }}
                >
                  Prikaži sve
                </Button>
              )
          }
          rowActionLabel={(worker) => `Više radnji za ${worker.firstName} ${worker.lastName}`}
          actions={(worker) =>
            canManage
              ? [
                  {
                    key: "edit",
                    label: "Izmijeni",
                    onSelect: () => setEditing({ worker, returnTo: null }),
                  },
                  ...(worker.email
                    ? [{
                        key: "copy-email",
                        label: "Kopiraj email",
                        onSelect: () => void navigator.clipboard?.writeText(worker.email ?? ""),
                      }]
                    : []),
                  ...(worker.phone
                    ? [{
                        key: "copy-phone",
                        label: "Kopiraj telefon",
                        onSelect: () => void navigator.clipboard?.writeText(worker.phone ?? ""),
                      }]
                    : []),
                  {
                    key: "toggle",
                    label: worker.isActive ? "Deaktiviraj" : "Aktiviraj",
                    danger: true,
                    onSelect: () => void toggleActive(worker),
                  },
                ]
              : []
          }
        />
        {!canManage && state.kind === "ready" && visible.length > 0 ? <p>samo pregled</p> : null}
      </Card>

      {editing ? (
        <WorkerDialog
          worker={editing.worker}
          workers={workers}
          canLinkUser={canLinkUser}
          returnFocusTo={editing.returnTo}
          onSaved={async (text) => {
            setEditing(null);
            setMessage({ tone: "success", text });
            await load();
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

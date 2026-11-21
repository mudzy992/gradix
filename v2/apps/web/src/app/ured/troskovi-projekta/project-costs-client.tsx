"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, DataTable, EmptyState, FilterBar, Input, Select, Skeleton, Stack,
} from "@/components/ui/index";
import { formatDateTime } from "@/format";
import type { ProjectCostEntryRow } from "@/server/project-cost-types";

type Caps = { canBook: boolean };
type ProjectOption = { id: string; code: string; name: string };
type BookOutcome = {
  outcome: string;
  booked?: number;
  skippedExisting?: number;
  skippedNoRate?: number;
  message?: string;
};

export function ProjectCostsClient({
  initialEntries,
  caps,
}: {
  initialEntries: ProjectCostEntryRow[];
  caps: Caps;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await apiCall<{ projects: ProjectOption[] }>("/api/projects");
    if (!res.ok) {
      setLoadError(res.message);
      setLoading(false);
      return;
    }
    setProjects(res.data.projects.map((p) => ({ id: p.id, code: p.code, name: p.name })));
    setLoading(false);
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => { setEntries(initialEntries); }, [initialEntries]);

  const visible = useMemo(() => {
    let rows = entries;
    if (projectFilter) rows = rows.filter((row) => row.project_id === projectFilter);
    if (from) rows = rows.filter((row) => row.booked_at.slice(0, 10) >= from);
    if (to) rows = rows.filter((row) => row.booked_at.slice(0, 10) <= to);
    return rows;
  }, [entries, projectFilter, from, to]);

  const bookPeriod = async () => {
    if (!from || !to) {
      setNotice({ tone: "error", text: "Unesite period (od–do) za knjiženje." });
      return;
    }
    setBusy(true);
    const res = await apiCall<BookOutcome>(
      "/api/project-cost-entries/book",
      jsonBody({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` }),
    );
    setBusy(false);
    if (!res.ok) {
      setNotice({ tone: "error", text: res.message });
      return;
    }
    if (res.data.outcome !== "OK") {
      setNotice({ tone: "error", text: res.data.message ?? "Knjiženje nije uspjelo." });
      return;
    }
    setNotice({
      tone: "success",
      text: `Knjiženo ${res.data.booked ?? 0}, već postojalo ${res.data.skippedExisting ?? 0}, bez stope ${res.data.skippedNoRate ?? 0}.`,
    });
    router.refresh();
  };

  const columns = useMemo(() => ([
    { key: "project", header: "Projekat", cell: (row: ProjectCostEntryRow) => `${row.project_code} — ${row.project_name}` },
    { key: "machine", header: "Mašina", cell: (row: ProjectCostEntryRow) => `${row.machine_code} — ${row.machine_name}` },
    { key: "hours", header: "Sati", cell: (row: ProjectCostEntryRow) => row.hours },
    { key: "rate", header: "Stopa", cell: (row: ProjectCostEntryRow) => `${row.rate} ${row.currency_code}` },
    { key: "amount", header: "Iznos", cell: (row: ProjectCostEntryRow) => `${row.amount} ${row.currency_code}` },
    { key: "booked", header: "Knjiženo", cell: (row: ProjectCostEntryRow) => formatDateTime(row.booked_at) },
  ]), []);

  if (loading) return <Skeleton rows={4} />;
  if (loadError) return <Alert tone="error" role="alert">{loadError}</Alert>;

  return (
    <Stack gap="var(--space-5)">
      {busy ? <Skeleton rows={2} /> : null}
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}
      <FilterBar>
        <Select label="Projekat" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
          <option value="">Svi projekti</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
          ))}
        </Select>
        <Input label="Od" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="Do" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {caps.canBook ? (
          <Button variant="primary" disabled={busy} onClick={() => void bookPeriod()}>
            Knjiži period
          </Button>
        ) : null}
      </FilterBar>
      <DataTable
        caption="Troškovi projekta"
        rows={visible}
        rowKey={(row) => row.id}
        columns={columns}
        empty={visible.length === 0 ? (
          <EmptyState
            title="Nema knjiženja"
            description="Knjižite period sati mašine da se pojave iznosi po projektu."
          />
        ) : undefined}
      />
    </Stack>
  );
}

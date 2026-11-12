"use client";

/**
 * R4a-2/B: lista sukoba. Filteri (stanje, starost, projekat) žive u adresi
 * (query parametri), klik na red vodi na zasebnu stranicu detalja
 * `/ured/sukobi/[id]` s istim filterima u adresi — „Nazad na listu" ih čuva.
 * Detalj se više ne otvara ispod tabele i nema modala za detalj.
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/api-client";
import {
  Card, Chip, DataTable, FilterBar, Inline, Mono, Select, Stat, TextLink,
} from "@/components/ui/index";
import { formatDate } from "@/format";
import type {
  WorkdayConflict, WorkdayConflictCountsResponse, WorkdayConflictsResponse,
} from "@gradix/contracts";
import { filtersToQuery, timesLabel, type ConflictFilters } from "./conflict-shared";

type Counts = WorkdayConflictCountsResponse;

export function ConflictsClient({
  initial, counts, initialFilters,
}: {
  initial: WorkdayConflict[];
  counts: Counts;
  initialFilters: ConflictFilters;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<WorkdayConflict[]>(initial);
  const [filters, setFilters] = useState<ConflictFilters>(initialFilters);
  const [countsState, setCountsState] = useState<Counts>(counts);

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.projectId) map.set(row.projectId, `${row.projectCode ?? ""} · ${row.projectName ?? ""}`);
    }
    if (filters.projectId && !map.has(filters.projectId)) {
      map.set(filters.projectId, filters.projectId);
    }
    return [...map.entries()];
  }, [rows, filters.projectId]);

  const applyFilters = useCallback(async (next: ConflictFilters) => {
    setFilters(next);
    router.replace(`/ured/sukobi?${filtersToQuery(next)}`, { scroll: false });
    const query = new URLSearchParams({ status: next.status, limit: "50" });
    if (next.olderOnly) query.set("olderThanDays", "0");
    if (next.projectId) query.set("projectId", next.projectId);
    const list = await apiCall<WorkdayConflictsResponse>(`/api/workday-conflicts?${query.toString()}`);
    if (list.ok) setRows(list.data.conflicts);
    const fresh = await apiCall<Counts>("/api/workday-conflicts/counts");
    if (fresh.ok) setCountsState(fresh.data);
  }, [router]);

  const detailHref = (id: string) => `/ured/sukobi/${id}?${filtersToQuery(filters)}`;

  return (
    <>
      <Card>
        <Inline>
          <Stat label="Nerazriješeni sukobi" value={String(countsState.open)} />
          <Stat label={`Stariji od ${countsState.thresholdDays} dana`} value={String(countsState.olderThanThreshold)} />
          {countsState.olderThanThreshold > 0 ? (
            <Chip tone="hot">{countsState.olderThanThreshold} stariji od {countsState.thresholdDays} dana</Chip>
          ) : null}
        </Inline>
      </Card>

      <FilterBar>
        <Select
          label="Stanje"
          value={filters.status}
          onChange={(event) => void applyFilters({ ...filters, status: event.target.value as "OPEN" | "RESOLVED" })}
        >
          <option value="OPEN">Nerazriješeni</option>
          <option value="RESOLVED">Razriješeni</option>
        </Select>
        <Select
          label="Starost"
          value={filters.olderOnly ? "old" : "all"}
          onChange={(event) => void applyFilters({ ...filters, olderOnly: event.target.value === "old" })}
        >
          <option value="all">Svi</option>
          <option value="old">Stariji od praga ({countsState.thresholdDays} d.)</option>
        </Select>
        <Select
          label="Projekat"
          value={filters.projectId}
          onChange={(event) => void applyFilters({ ...filters, projectId: event.target.value })}
        >
          <option value="">Svi projekti</option>
          {projects.map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        caption="Sukobi radnih dana"
        rows={rows}
        rowKey={(row) => row.id}
        emptyText="Nema sukoba za izabrane filtere."
        columns={[
          {
            key: "worker", header: "Radnik", cell: (row) => (
              <TextLink href={detailHref(row.id)}>{row.workerName ?? "Otvori sukob"}</TextLink>
            ),
          },
          { key: "project", header: "Projekat", cell: (row) => (row.projectCode ? `${row.projectCode} · ${row.projectName ?? ""}` : "—") },
          { key: "date", header: "Datum", cell: (row) => (row.workDate ? formatDate(row.workDate) : "—") },
          {
            key: "times", header: "Server / telefon", cell: (row) => (
              <Mono>{timesLabel(row.serverTimes)} / {timesLabel(row.receivedTimes)}</Mono>
            ),
          },
          {
            key: "since", header: "Čeka", cell: (row) => (
              row.status === "RESOLVED"
                ? <Chip tone="full">Razriješeno</Chip>
                : row.ageDays >= countsState.thresholdDays
                  ? <Chip tone="hot">prije {row.ageDays} d.</Chip>
                  : <span>prije {row.ageDays} d.</span>
            ),
          },
          {
            key: "open", header: "", cell: (row) => (
              <TextLink href={detailHref(row.id)}>Otvori</TextLink>
            ),
          },
        ]}
      />
      <p>
        Ime radnika i <strong>Otvori</strong> vode na stranicu sukoba. Lista je
        zadano filtrirana na nerazriješene — isto važi za bedž u navigaciji i
        karticu na Pregledu.
      </p>
    </>
  );
}

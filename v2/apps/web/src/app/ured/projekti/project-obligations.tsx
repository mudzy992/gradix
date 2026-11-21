"use client";

/** Rokovi na projektu (samo čitanje, iz detalja projekta). */
import { useEffect, useState } from "react";
import { apiCall } from "@/api-client";
import { formatDate } from "@/format";
import { Alert, Chip, DataTable, EmptyState, Skeleton } from "@/components/ui/index";

export function ProjectObligations({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<{ id: string; typeLabel: string; state: string; expiresAt: string | null }[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiCall<{ obligations: { id: string; typeLabel: string; state: string; expiresAt: string | null }[] }>(
      `/api/obligations?projectId=${projectId}`,
    ).then((result) => {
      if (!result.ok) {
        setError(result.message);
        setRows([]);
        return;
      }
      setRows(result.data.obligations);
    });
  }, [projectId]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (rows === null) return <Skeleton rows={3} />;

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nema rokova na projektu"
        description="Građevinska dozvola, saglasnosti i HSE elaborat dodaju se u Rokovima, sa projektom kao entitetom."
      />
    );
  }

  return (
    <DataTable
      caption="Rokovi na projektu"
      rows={rows}
      rowKey={(row) => row.id}
      emptyText="Nema rokova."
      columns={[
        { key: "type", header: "Obaveza", cell: (row) => <span className="gx-who">{row.typeLabel}</span> },
        { key: "expires", header: "Rok", cell: (row) => (row.expiresAt ? formatDate(row.expiresAt) : "bez roka") },
        {
          key: "state",
          header: "Stanje",
          cell: (row) =>
            row.state === "expired" ? (
              <Chip tone="hot">Isteklo</Chip>
            ) : row.state === "expiring" ? (
              <Chip tone="hollow">Uskoro istječe</Chip>
            ) : (
              <Chip tone="full">Važeće</Chip>
            ),
        },
      ]}
    />
  );
}

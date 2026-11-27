"use client";

import { DataTable, Mono, Stack } from "@/components/ui/index";
import { formatDate } from "../tenders-shared";

export type TenderPhaseRow = {
  id: string;
  code: string;
  name: string;
  weight: number;
  plannedStart: string | null;
  plannedEnd: string | null;
};

/**
 * Tab „Tim“: predloženi ljudi i faze koje konverzija prenosi na projekat (spec 08 §1.6).
 *
 * Ekran je NAMJERNO čitanje: tim i faze se puni iz tendera kakav je stigao (portal, poziv,
 * dokumentacija), a ne kucanjem u v2 — unos kroz ekran bi bio šesti način da isti podatak
 * nastane. Konverzija ih prenosi, a PM potvrđuje dodjele na projektu.
 */
export function TenderTeamTab({
  team,
  phases,
}: {
  team: Array<{ workerId: string; name: string; role: string }>;
  phases: TenderPhaseRow[];
}) {
  return (
    <Stack>
      <section className="gx-card">
        <h3 className="gx-section-title">Predloženi tim</h3>
        <p className="gx-page-sub">
          Pri konverziji tim se upisuje kao predlog dodjela („predlog iz tendera“); potvrđuje ga
          vođa projekta.
        </p>
        {team.length === 0 ? (
          <p className="gx-page-sub">Tim nije predložen uz ovaj tender.</p>
        ) : (
          <DataTable
            caption="Predloženi tim"
            rowKey={(row) => row.workerId}
            rows={team}
            emptyText="Nema članova."
            columns={[
              { key: "name", header: "Radnik", cell: (row) => row.name },
              {
                key: "role",
                header: "Uloga",
                cell: (row) =>
                  row.role === "PM" ? "Vođa projekta" : row.role === "SUPERVISOR" ? "Šef gradilišta" : "Član",
              },
            ]}
          />
        )}
      </section>

      <section className="gx-card">
        <h3 className="gx-section-title">Faze posla</h3>
        <p className="gx-page-sub">
          Ako faze nijesu unesene, konverzija pravi jednu fazu „Izvođenje“ sa težinom 1.
        </p>
        {phases.length === 0 ? (
          <p className="gx-page-sub">Nema faza.</p>
        ) : (
          <DataTable
            caption="Faze tendera"
            rowKey={(row) => row.id}
            rows={phases}
            emptyText="Nema faza."
            columns={[
              { key: "code", header: "Oznaka", cell: (row) => <Mono>{row.code}</Mono> },
              { key: "name", header: "Naziv", cell: (row) => row.name },
              { key: "weight", header: "Težina", numeric: true, cell: (row) => String(row.weight) },
              { key: "start", header: "Planiran početak", cell: (row) => formatDate(row.plannedStart) },
              { key: "end", header: "Planiran kraj", cell: (row) => formatDate(row.plannedEnd) },
            ]}
          />
        )}
      </section>
    </Stack>
  );
}

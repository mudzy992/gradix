"use client";

/** Tabela radnih dana — klijentska jer DataTable prima funkcije ćelija. */
import { DataTable } from "@/components/ui/index";
import { reviewLabel } from "./review-label";
import type { WorkdayReviewRow } from "@/server/workday-review";

export function WorkdaysTable({ days }: { days: WorkdayReviewRow[] }) {
  return (
    <DataTable
      caption="Radni dani"
      rows={days}
      rowKey={(day) => day.id}
      emptyText="Još nema pristiglih radnih dana."
      columns={[
        {
          key: "worker",
          header: "Radnik · datum",
          cell: (day) => (
            <span>
              <strong>{day.worker_name}</strong>
              <br />
              {day.work_date}
            </span>
          ),
        },
        { key: "projects", header: "Projekti", cell: (day) => day.project_codes ?? "—" },
        { key: "entries", header: "Unosi", cell: (day) => day.entries },
        { key: "status", header: "Stanje", cell: (day) => (day.status === "SUBMITTED" ? "Poslano" : "Nacrt") },
        { key: "label", header: "Oznaka", cell: (day) => reviewLabel(day) ?? "—" },
      ]}
    />
  );
}

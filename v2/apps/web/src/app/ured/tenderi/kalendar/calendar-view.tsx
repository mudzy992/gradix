"use client";

import Link from "next/link";
import { Chip, DataTable, Mono } from "@/components/ui/index";
import { deadlineText, deadlineTone, formatDateTime, STATUS_LABEL } from "../tenders-shared";
import type { TenderStatus } from "@gradix/contracts";

export type CalendarRow = {
  kind: string;
  tenderId: string;
  title: string;
  at: string;
  extra: string | null;
  days: number;
  status: TenderStatus;
};

/**
 * Spisak rokova (klijentski) — jedan spisak sortiran po datumu.
 *
 * Mjesečna mreža bi tražila više koda i manje koristi — posao je „šta mi slijedi“, ne „kako
 * izgleda mjesec“. Boja je uz tekst (`deadlineText`), nikad sama.
 */
export function CalendarView({ rows }: { rows: CalendarRow[] }) {
  return (
    <DataTable
      caption="Tenderski rokovi i garancije"
      rowKey={(row) => `${row.tenderId}:${row.kind}:${row.at}`}
      rows={rows}
      emptyText="Nema rokova ni garancija."
      columns={[
        { key: "when", header: "Datum", cell: (row) => <Mono>{formatDateTime(row.at)}</Mono> },
        {
          key: "days",
          header: "Do roka",
          cell: (row) => (
            <Chip tone={deadlineTone(row.days) === "danger" ? "hot" : "hollow"}>
              {deadlineText(row.days, row.at)}
            </Chip>
          ),
        },
        { key: "kind", header: "Događaj", cell: (row) => row.kind },
        {
          key: "tender",
          header: "Tender",
          cell: (row) => (
            <Link className="gx-link" href={`/ured/tenderi/${row.tenderId}`}>{row.title}</Link>
          ),
        },
        { key: "extra", header: "Detalj", cell: (row) => row.extra ?? "—" },
        { key: "status", header: "Status", cell: (row) => STATUS_LABEL[row.status] },
      ]}
    />
  );
}

"use client";

/** Tabela mašina na Pregledu — klijentska jer DataTable prima funkcije ćelija. */
import { DataTable, Mono } from "@/components/ui/index";

export function MachinesTable({ machines }: { machines: { code: string; name: string }[] }) {
  return (
    <DataTable
      caption="Mašine u evidenciji"
      rows={machines}
      rowKey={(machine) => machine.code}
      emptyText="Nema mašina."
      columns={[
        { key: "name", header: "Mašina", cell: (machine) => machine.name },
        { key: "code", header: "Šifra", cell: (machine) => <Mono>{machine.code}</Mono> },
      ]}
    />
  );
}

"use client";

/**
 * U5 — katalog komponenti: svaka komponenta u svim stanjima, na jednom mjestu.
 * Otvara se na /katalog (samo prijavljeni; nije u navigaciji — razvojni alat).
 * Ako ovdje nešto fali, nedostaje i u sistemu: dodaj komponentu, ne kopiju po ekranu.
 */
import { useState } from "react";
import {
  Alert, Button, Card, Checkbox, Chip, ConfirmDialog, DataTable, DescriptionList,
  EmptyState, FilterBar, FormGrid, FormSection, IconButton, Inline, Input, PageHeader,
  Pagination, Select, Skeleton, Stack, StatusDot, Tabs, Textarea,
} from "./index";

const rows = [
  { id: "1", name: "Amina Karić", role: "Zidar", active: true },
  { id: "2", name: "Mujo Softić", role: "Rukovalac", active: false },
];

export function ComponentCatalog() {
  const [tab, setTab] = useState("kontrole");
  const [confirm, setConfirm] = useState(false);
  const [page, setPage] = useState(false);
  return (
    <div>
      <PageHeader title="Katalog komponenti" subtitle="UI sistem (Dio U) — sve komponente i stanja. Obje teme: prekidač u zaglavlju." />
      <Tabs
        label="Dijelovi kataloga"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "kontrole", label: "Kontrole" },
          { key: "tabela", label: "Tabela i stanja" },
          { key: "preklopi", label: "Preklopi" },
        ]}
      />
      {tab === "kontrole" ? (
        <Stack>
          <Card>
            <FormGrid>
              <Input label="Tekst" id="cat-text" placeholder="Placeholder" hint="Pomoćni tekst ispod polja." />
              <Input label="Greška" id="cat-err" error="Obavezno polje." defaultValue="" />
              <Select label="Izbor" id="cat-sel">
                <option>Prva opcija</option>
                <option>Druga opcija</option>
              </Select>
              <Input label="Datum" id="cat-date" type="date" />
            </FormGrid>
            <Textarea label="Napomena" id="cat-note" placeholder="Duži tekst…" />
            <Checkbox label="Potvrđujem (checkbox s labelom)" id="cat-check" defaultChecked />
            <Inline>
              <Button variant="primary">Primarno</Button>
              <Button>Standardno</Button>
              <Button variant="quiet">Tiho</Button>
              <Button variant="danger">Opasno</Button>
              <Button disabled>Onemogućeno</Button>
              <IconButton icon="sun" label="Tema (primjer IconButton)" />
            </Inline>
            <Inline>
              <Chip tone="full">Aktivan</Chip>
              <Chip tone="hollow">Neaktivan</Chip>
              <StatusDot tone="ok" label="StatusDot ok" />
              <StatusDot tone="warn" label="StatusDot upozorenje" />
              <StatusDot tone="muted" label="StatusDot mirno" />
            </Inline>
          </Card>
          <Alert tone="success">Uspjeh: poruka (success).</Alert>
          <Alert tone="error">Greška: poruka (error).</Alert>
          <FormSection title="FormSection s opisnom listom">
            <DescriptionList items={[{ term: "Radnik", value: "Amina Karić" }, { term: "Status", value: "Aktivan" }]} />
          </FormSection>
        </Stack>
      ) : null}
      {tab === "tabela" ? (
        <Stack>
          <Card>
            <FilterBar>
              <Input label="Filter (primjer)" id="cat-filter" placeholder="Traži…" />
            </FilterBar>
            <DataTable
              caption="Primjer tabele"
              rows={rows}
              rowKey={(row) => row.id}
              rowActionLabel={(row) => `Više radnji za ${row.name}`}
              columns={[
                { key: "name", header: "Ime", cell: (row) => row.name },
                { key: "role", header: "Uloga", cell: (row) => row.role },
                { key: "st", header: "Status", cell: (row) => <Chip tone={row.active ? "full" : "hollow"}>{row.active ? "Aktivan" : "Neaktivan"}</Chip> },
              ]}
              actions={(row) => [
                { key: "edit", label: "Izmijeni", onSelect: () => undefined },
                { key: "toggle", label: row.active ? "Deaktiviraj" : "Aktiviraj", danger: true, onSelect: () => undefined },
              ]}
            />
            <Pagination hasPrev={page} hasMore onPrev={() => setPage(false)} onNext={() => setPage(true)} />
          </Card>
          <Skeleton rows={3} />
          <EmptyState title="Prazno stanje" description="Kad nema zapisa, ekran ovo pokazuje — s akcijom kad postoji." action={<Button>Dodaj</Button>} />
        </Stack>
      ) : null}
      {tab === "preklopi" ? (
        <Card>
          <p>ConfirmDialog se otvara dugmetom (fokus, Escape, povrat fokusa iz Dialog primitiva).</p>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Otvori potvrdu
          </Button>
          <ConfirmDialog
            open={confirm}
            title="Deaktivirati radnika?"
            text="Zapis i istorija ostaju; radnik se više ne nudi za nove unose."
            confirmLabel="Deaktiviraj"
            danger
            onConfirm={() => setConfirm(false)}
            onCancel={() => setConfirm(false)}
          />
        </Card>
      ) : null}
    </div>
  );
}

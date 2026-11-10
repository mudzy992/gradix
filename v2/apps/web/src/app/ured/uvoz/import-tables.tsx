"use client";

/** Dijelovi ekrana uvoza: pregled redova, odluke po redu i rezultat (U4: fajlovi ≤~300 linija). */
import type { ImportDecision, ImportPreview, ImportPreviewRow, ImportResult } from "@gradix/contracts";
import {
  Alert, Button, Card, Chip, DataTable, EmptyState, Icon, Mono, Radio, SectionTitle,
} from "@/components/ui/index";

const OUTCOME_LABEL: Record<ImportPreviewRow["outcome"], string> = {
  import: "Uvozi se",
  skip: "Postoji — preskočeno",
  error: "Greška",
  duplicate: "Mogući duplikat",
};

const availableActions = (row: ImportPreviewRow): { value: ImportDecision["action"]; label: string }[] => {
  if (row.outcome === "error") return [];
  if (row.outcome === "skip") return [{ value: "update", label: "Ažuriraj postojeće" }];
  if (row.outcome === "duplicate") return [{ value: "import", label: "Uvezi kao novog" }];
  return [{ value: "import", label: "Uvezi" }];
};

export function PreviewTable({ preview }: { preview: ImportPreview }) {
  const rows = preview.rows;
  return (
    <Card>
      <SectionTitle
        hint={`${preview.counts.import} za uvoz · ${preview.counts.skip} postoji · ${preview.counts.duplicate} mogućih duplikata · ${preview.counts.error} grešaka${
          preview.ignoredSheets > 0 ? ` · ${preview.ignoredSheets} list(ova) nije čitan` : ""
        }`}
      >
        Pregled redova
      </SectionTitle>

      {rows.length === 0 ? (
        <EmptyState title="Fajl nema redova" description="Provjerite da prvi list sadrži zaglavlje i podatke." />
      ) : (
        <DataTable
          caption="Pregled redova uvoza"
          rows={rows}
          rowKey={(row) => String(row.rowNumber)}
          emptyText="Fajl nema redova."
          columns={[
            { key: "row", header: "Red", cell: (row) => <Mono>{row.rowNumber}</Mono> },
            { key: "summary", header: "Šta piše u fajlu", cell: (row) => row.summary },
            {
              key: "outcome",
              header: "Ishod",
              cell: (row) => (
                <Chip tone={row.outcome === "import" ? "full" : row.outcome === "error" ? "hot" : "hollow"}>
                  {OUTCOME_LABEL[row.outcome]}
                </Chip>
              ),
            },
            { key: "reason", header: "Zašto", cell: (row) => <span className="gx-page-sub">{row.reason ?? "—"}</span> },
          ]}
        />
      )}
    </Card>
  );
}

export function DecisionRow({
  row,
  value,
  onChange,
}: {
  row: ImportPreviewRow;
  value: ImportDecision["action"];
  onChange: (action: ImportDecision["action"]) => void;
}) {
  const options = availableActions(row);
  const chosen = options.some((option) => option.value === value) ? value : "skip";
  const inputId = `decision-${row.rowNumber}`;

  return (
    <div className="gx-inline-flex">
      <Mono>Red {row.rowNumber}</Mono>
      <div>
        <div><strong>{row.summary}</strong></div>
        <div className="gx-page-sub">
          {OUTCOME_LABEL[row.outcome]}
          {row.reason ? ` — ${row.reason}` : ""}
        </div>
      </div>
      <div className="gx-inline-flex">
        {options.map((option) => (
          <Radio
            key={option.value}
            label={option.label}
            id={`${inputId}-${option.value}`}
            name={inputId}
            checked={chosen === option.value}
            onChange={() => onChange(option.value)}
          />
        ))}
        <Radio
          label="Preskoči"
          id={`${inputId}-skip`}
          name={inputId}
          checked={chosen === "skip"}
          onChange={() => onChange("skip")}
        />
      </div>
    </div>
  );
}

export function ResultCard({
  result,
  aborted,
  onReset,
}: {
  result: ImportResult;
  aborted: string | null;
  onReset: () => void;
}) {
  const nothingWritten = aborted !== null;
  return (
    <Card>
      <SectionTitle hint="Izvještaj se ne čuva kao fajl — u trag ide broj uvezenih, ne sadržaj.">
        4. Rezultat
      </SectionTitle>

      <div className="gx-stack">
        {nothingWritten ? (
          <Alert tone="error" role="alert">
            {aborted}
          </Alert>
        ) : (
          <Alert tone="success">
            Uvezeno {result.imported}, ažurirano {result.updated}, preskočeno {result.skipped}.
          </Alert>
        )}

        {result.errors.length > 0 ? (
          <div>
            <p><strong>Redovi koji nisu prošli</strong></p>
            <ul className="gx-stack gx-stack--2">
              {result.errors.map((entry) => (
                <li key={`${entry.rowNumber}-${entry.message}`}>
                  Red {entry.rowNumber}: {entry.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="gx-inline-flex">
          <Button variant="primary" onClick={onReset}>
            Novi uvoz
          </Button>
          <Button variant="quiet" onClick={() => (window.location.href = "/ured/radnici")}>
            Otvori radnike
          </Button>
          <Button variant="quiet" onClick={() => (window.location.href = "/ured/masine")}>
            Otvori mašine
          </Button>
        </div>

        <p className="gx-page-sub">
          <Icon name="info" /> Uvoz je zabilježen u audit tragu kao jedna radnja — bez imena i kontakata.
        </p>
      </div>
    </Card>
  );
}

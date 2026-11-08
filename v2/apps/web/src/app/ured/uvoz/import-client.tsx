"use client";

/**
 * Uvoz iz Excela — četiri koraka, po odluci vlasnika.
 *
 *   1. **Fajl** — vrsta uvoza (radnici ili mašine) i sama datoteka.
 *   2. **Mapiranje i pregled** — koja kolona ide u koje polje, red po red, sa razlogom.
 *      Pregled NE piše ništa; to i piše na ekranu, da niko ne čeka kraj da vidi šta se desilo.
 *   3. **Odluke** — po redu: uvezi / preskoči / ažuriraj. Ništa se ne prepisuje bez izbora.
 *   4. **Rezultat** — šta je ušlo, šta nije i zašto.
 *
 * Tri stvari koje ekran namjerno radi drukčije od „običnog“ uvoza:
 *  - **Potvrda šalje isti fajl ponovo.** Server tako ponovo parsira i validira isti sadržaj;
 *    klijent ne može podmetnuti vrijednosti koje pregled nije vidio.
 *  - **Blokade su odvojene od napomena.** Dok postoji blokada (nemapirano obavezno polje),
 *    dugme za potvrdu je onemogućeno; neuvežena kolona samo piše zašto.
 *  - **Greška ruši sve.** Ako potvrda pukne na nekom redu, ništa nije uvezeno i ekran to kaže
 *    prvo, a tek onda prikaže red.
 */
import { useRef, useState } from "react";
import type { ImportDecision, ImportPreview, ImportPreviewRow, ImportResult } from "@gradix/contracts";
import { Alert, Button, Card, Chip, EmptyState, Field, Icon, Mono, SectionTitle, Skeleton, inputClass } from "@/components/ui";

type Kind = "workers" | "equipment";

/**
 * Polja za mapiranje — ista imena kao na serveru (`WORKER_FIELDS` / `EQUIPMENT_FIELDS`).
 * Ovdje su samo natpisi i redoslijed; server je izvor istine i sam odbija nepotpuno mapiranje.
 */
const FIELDS: Record<Kind, { key: string; label: string; required: boolean }[]> = {
  workers: [
    { key: "firstName", label: "Ime", required: true },
    { key: "lastName", label: "Prezime", required: true },
    { key: "phone", label: "Telefon", required: false },
    { key: "email", label: "Email", required: false },
    { key: "jobTitle", label: "Zanimanje", required: false },
    { key: "engagement", label: "Angažman", required: false },
    { key: "hiredAt", label: "Datum početka", required: true },
    { key: "endedAt", label: "Datum prestanka", required: false },
    { key: "team", label: "Ekipa", required: false },
    { key: "supervisor", label: "Nadređeni", required: false },
  ],
  equipment: [
    { key: "code", label: "Inventarska oznaka", required: true },
    { key: "name", label: "Naziv", required: true },
    { key: "category", label: "Kategorija", required: true },
    { key: "make", label: "Marka", required: false },
    { key: "model", label: "Model", required: false },
    { key: "serialNo", label: "Serijski broj", required: false },
    { key: "plate", label: "Registarska oznaka", required: false },
    { key: "year", label: "Godina", required: false },
    { key: "ownership", label: "Vlasništvo", required: false },
    { key: "meterValue", label: "Stanje brojila", required: false },
  ],
};

const OUTCOME_LABEL: Record<ImportPreviewRow["outcome"], string> = {
  import: "Uvozi se",
  skip: "Postoji — preskočeno",
  error: "Greška",
  duplicate: "Mogući duplikat",
};

/** Početna odluka po redu: ono što pregled predlaže, ništa više. */
function defaultAction(row: ImportPreviewRow): ImportDecision["action"] {
  return row.outcome === "import" ? "import" : "skip";
}

const availableActions = (row: ImportPreviewRow): { value: ImportDecision["action"]; label: string }[] => {
  if (row.outcome === "error") return [];
  if (row.outcome === "skip") return [{ value: "update", label: "Ažuriraj postojeće" }];
  if (row.outcome === "duplicate") return [{ value: "import", label: "Uvezi kao novog" }];
  return [{ value: "import", label: "Uvezi" }];
};

export default function ImportClient() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [kind, setKind] = useState<Kind>("workers");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [decisions, setDecisions] = useState<Record<number, ImportDecision["action"]>>({});
  const [result, setResult] = useState<{ result: ImportResult; aborted: string | null } | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "apply">(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Svaki zahtjev dobija redni broj: odgovor na staro mapiranje ne smije pregaziti novo.
  const requestId = useRef(0);

  const fields = FIELDS[kind];

  function reset() {
    setStep(1);
    setFile(null);
    setPreview(null);
    setMapping({});
    setDecisions({});
    setResult(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function formFor(target: File, nextMapping?: Record<string, string | null>): FormData {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", target);
    if (nextMapping) form.set("mapping", JSON.stringify(nextMapping));
    return form;
  }

  async function runPreview(target: File, nextMapping?: Record<string, string | null>) {
    const id = ++requestId.current;
    setBusy("preview");
    setError(null);
    try {
      const response = await fetch("/api/imports/preview", { method: "POST", body: formFor(target, nextMapping) });
      const body = await response.json().catch(() => null);
      if (id !== requestId.current) return; // stariji odgovor — ignoriši
      if (!response.ok || !body?.success) {
        setError(body?.error?.message ?? "Fajl nije pročitan. Provjerite da je .xlsx ili .csv.");
        return;
      }
      const data = body.data as ImportPreview;
      setPreview(data);
      setMapping(data.mapping);
      setDecisions(Object.fromEntries(data.rows.map((row) => [row.rowNumber, defaultAction(row)])));
      setStep(2);
    } catch {
      if (id !== requestId.current) return;
      setError("Nema veze sa serverom. Provjerite mrežu i pokušajte ponovo.");
    } finally {
      if (id === requestId.current) setBusy(null);
    }
  }

  async function apply() {
    if (!file || !preview) return;
    setBusy("apply");
    setError(null);
    try {
      const form = formFor(file, mapping);
      form.set(
        "decisions",
        JSON.stringify(
          Object.entries(decisions).map(([rowNumber, action]) => ({ rowNumber: Number(rowNumber), action })),
        ),
      );
      const response = await fetch("/api/imports/apply", { method: "POST", body: form });
      const body = await response.json().catch(() => null);
      if (!body) {
        setError("Server nije vratio odgovor koji razumijem.");
        return;
      }
      if (response.ok && body.success) {
        setResult({ result: body.data as ImportResult, aborted: null });
        setStep(4);
        return;
      }
      // Prekinut uvoz: `data` nosi izvještaj (koji red, zašto), a `error` poruku za čovjeka.
      if (body.data) {
        setResult({ result: body.data as ImportResult, aborted: body.error?.message ?? "Uvoz je prekinut." });
        setStep(4);
        return;
      }
      setError(body.error?.message ?? "Uvoz nije prošao.");
    } catch {
      setError("Nema veze sa serverom. Ništa nije uvezeno — provjerite mrežu i pokušajte ponovo.");
    } finally {
      setBusy(null);
    }
  }

  const changeMapping = (field: string, column: string) => {
    const next = { ...mapping, [field]: column === "" ? null : column };
    setMapping(next);
    if (file) void runPreview(file, next);
  };

  const selectedCount = Object.values(decisions).filter((action) => action !== "skip").length;
  const actionable = preview ? preview.rows.filter((row) => row.outcome !== "error") : [];

  return (
    <div>
      <div className="gx-page-head">
        <div className="gx-page-head__text">
          <h1 className="gx-page-title">Uvoz iz Excela</h1>
          <p className="gx-page-sub">
            Spisak radnika ili mašina. Pregled ne mijenja ništa — uvoz se potvrđuje red po red.
          </p>
        </div>
        {step > 1 ? (
          <div className="gx-page-head__actions">
            <Button onClick={reset}>Novi uvoz</Button>
          </div>
        ) : null}
      </div>

      <ol className="gx-steps" aria-label="Koraci uvoza">
        {[
          { n: 1, label: "Fajl" },
          { n: 2, label: "Mapiranje i pregled" },
          { n: 3, label: "Odluke" },
          { n: 4, label: "Rezultat" },
        ].map((item) => (
          <li key={item.n} aria-current={step === item.n ? "step" : undefined} data-done={step > item.n}>
            <span aria-hidden="true" className="gx-steps__num">
              {step > item.n ? "✓" : item.n}
            </span>
            {item.label}
          </li>
        ))}
      </ol>

      {error ? (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      ) : null}

      {step === 1 ? (
        <Card>
          <SectionTitle hint="Fajl se čita, ali se ništa ne upisuje u bazu.">1. Izaberite fajl</SectionTitle>
          <div style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-4)" }}>
            <div className="gx-field">
              <span className="gx-field__label" id="import-kind-label">
                Vrsta uvoza
              </span>
              <div role="group" aria-labelledby="import-kind-label" className="gx-seg">
                <button type="button" aria-pressed={kind === "workers"} onClick={() => setKind("workers")}>
                  Radnici
                </button>
                <button type="button" aria-pressed={kind === "equipment"} onClick={() => setKind("equipment")}>
                  Mašine i vozila
                </button>
              </div>
            </div>

            <Field
              label="Datoteka"
              htmlFor="import-file"
              hint=".xlsx ili .csv, do 5 MB i 5000 redova. Prvi list se čita; ostali se prijavljuju."
            >
              <input
                ref={fileInput}
                id="import-file"
                className={inputClass}
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => {
                  const chosen = event.target.files?.[0] ?? null;
                  setFile(chosen);
                  setPreview(null);
                  setError(null);
                }}
              />
            </Field>

            <p style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
              {kind === "workers"
                ? "Obavezno: ime, prezime, datum početka. Lični podaci (JMBG, adresa, račun) se ne uvoze."
                : "Obavezno: inventarska oznaka, naziv, kategorija. Nepoznata kategorija se prijavljuje, ne stvara."}
            </p>

            <div>
              <Button
                variant="primary"
                icon="folder"
                disabled={!file || busy !== null}
                onClick={() => file && void runPreview(file)}
              >
                {busy === "preview" ? "Čitam fajl…" : "Pregledaj fajl"}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {busy === "preview" && step > 1 ? <Skeleton rows={3} /> : null}

      {step === 2 && preview ? (
        <div style={{ display: "grid", gap: "var(--space-5)" }}>
          <Card>
            <SectionTitle hint={`${preview.fileName} · list „${preview.sheetName}“`}>2. Mapiranje kolona</SectionTitle>
            {preview.blockers.length > 0 ? (
              <div style={{ marginTop: "var(--space-3)" }}>
                <Alert tone="error" role="alert">
                  <span>
                    Uvoz ne može da krene dok se ne mapira: {preview.blockers.join(" ")}
                  </span>
                </Alert>
              </div>
            ) : null}

            <div className="gx-filters" style={{ marginTop: "var(--space-4)" }}>
              {fields.map((field) => (
                <Field
                  key={field.key}
                  label={`${field.label}${field.required ? " *" : ""}`}
                  htmlFor={`map-${field.key}`}
                >
                  <select
                    id={`map-${field.key}`}
                    className={inputClass}
                    value={mapping[field.key] ?? ""}
                    onChange={(event) => changeMapping(field.key, event.target.value)}
                  >
                    <option value="">— ne uvozi se —</option>
                    {preview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>

            {preview.notices.length > 0 ? (
              <div style={{ marginTop: "var(--space-4)" }}>
                <Alert tone="warning">
                  <span>
                    {preview.notices.length === 1
                      ? preview.notices[0]
                      : `Ove kolone nisu uvezene (${preview.notices.length}): ${preview.notices.join(" ")}`}
                  </span>
                </Alert>
              </div>
            ) : null}

            <p style={{ marginTop: "var(--space-3)", fontSize: "var(--text-small)", color: "var(--muted)" }}>
              Pregled ne mijenja podatke. Promjena mapiranja ponovo čita isti fajl.
            </p>
          </Card>

          <PreviewTable preview={preview} />

          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <Button
              variant="primary"
              fullWidthOnMobile
              disabled={preview.blockers.length > 0}
              onClick={() => setStep(3)}
            >
              Dalje na odluke
            </Button>
            <Button variant="quiet" onClick={reset}>
              Odustani
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 && preview ? (
        <div style={{ display: "grid", gap: "var(--space-5)" }}>
          <Card>
            <SectionTitle hint="Ništa se ne prepisuje bez vašeg izbora.">3. Odluke po redu</SectionTitle>
            <p style={{ marginTop: "var(--space-2)", fontSize: "var(--text-small)", color: "var(--muted)" }}>
              Redovi sa greškom se ne mogu uvesti — popravite fajl i pokrenite pregled ponovo.
            </p>

            {actionable.length === 0 ? (
              <div style={{ marginTop: "var(--space-4)" }}>
                <EmptyState
                  title="Nema redova za uvoz"
                  description="Svi redovi imaju grešku ili je fajl prazan."
                  action={<Button onClick={reset}>Izaberite drugi fajl</Button>}
                />
              </div>
            ) : (
              <div style={{ marginTop: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
                {actionable.map((row) => (
                  <DecisionRow
                    key={row.rowNumber}
                    row={row}
                    value={decisions[row.rowNumber] ?? "skip"}
                    onChange={(action) => setDecisions((current) => ({ ...current, [row.rowNumber]: action }))}
                  />
                ))}
              </div>
            )}
          </Card>

          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
            <Button
              variant="primary"
              fullWidthOnMobile
              disabled={busy !== null || selectedCount === 0}
              onClick={() => void apply()}
            >
              {busy === "apply"
                ? "Upisujem…"
                : `Uvezi ${selectedCount} ${selectedCount === 1 ? "red" : selectedCount < 5 ? "reda" : "redova"}`}
            </Button>
            <Button variant="quiet" onClick={() => setStep(2)} disabled={busy !== null}>
              Nazad na pregled
            </Button>
            <span style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
              Sve ili ništa: ako jedan red padne, nijedan se ne upisuje.
            </span>
          </div>
        </div>
      ) : null}

      {step === 4 && result ? (
        <ResultCard
          result={result.result}
          aborted={result.aborted}
          onReset={reset}
        />
      ) : null}
    </div>
  );
}

function PreviewTable({ preview }: { preview: ImportPreview }) {
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
        <div style={{ marginTop: "var(--space-4)" }}>
          <EmptyState title="Fajl nema redova" description="Provjerite da prvi list sadrži zaglavlje i podatke." />
        </div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: "var(--space-3)" }}>
          <table className="gx-table gx-table--cards">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Red</th>
                <th>Šta piše u fajlu</th>
                <th>Ishod</th>
                <th>Zašto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rowNumber}>
                  <td data-label="Red">
                    <Mono>{row.rowNumber}</Mono>
                  </td>
                  <td data-label="Šta piše u fajlu">{row.summary}</td>
                  <td data-label="Ishod">
                    <Chip tone={row.outcome === "import" ? "full" : row.outcome === "error" ? "hot" : "hollow"}>
                      {OUTCOME_LABEL[row.outcome]}
                    </Chip>
                  </td>
                  <td data-label="Zašto" style={{ color: "var(--muted)" }}>
                    {row.reason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DecisionRow({
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
    <div
      style={{
        display: "flex",
        gap: "var(--space-3)",
        alignItems: "flex-start",
        flexWrap: "wrap",
        padding: "var(--space-3) 0",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <Mono>Red {row.rowNumber}</Mono>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontWeight: 600 }}>{row.summary}</div>
        <div style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
          {OUTCOME_LABEL[row.outcome]}
          {row.reason ? ` — ${row.reason}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        {options.map((option) => (
          <label key={option.value} htmlFor={`${inputId}-${option.value}`} className="gx-check">
            <input
              id={`${inputId}-${option.value}`}
              type="radio"
              name={inputId}
              checked={chosen === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
        <label htmlFor={`${inputId}-skip`} className="gx-check">
          <input
            id={`${inputId}-skip`}
            type="radio"
            name={inputId}
            checked={chosen === "skip"}
            onChange={() => onChange("skip")}
          />
          Preskoči
        </label>
      </div>
    </div>
  );
}

function ResultCard({
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

      <div style={{ marginTop: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
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
            <p style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>Redovi koji nisu prošli</p>
            <ul style={{ display: "grid", gap: 6, paddingLeft: 20 }}>
              {result.errors.map((entry) => (
                <li key={`${entry.rowNumber}-${entry.message}`}>
                  Red {entry.rowNumber}: {entry.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
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

        <p style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
          <Icon name="info" /> Uvoz je zabilježen u audit tragu kao jedna radnja — bez imena i kontakata.
        </p>
      </div>
    </Card>
  );
}

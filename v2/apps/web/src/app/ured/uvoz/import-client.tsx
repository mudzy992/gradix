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
import { apiCall } from "@/api-client";
import {
  Alert, Button, Card, EmptyState, Input, PageHeader, SectionTitle, Segmented, Select, Skeleton,
} from "@/components/ui/index";
import { DecisionRow, PreviewTable, ResultCard } from "./import-tables";

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

/** Početna odluka po redu: ono što pregled predlaže, ništa više. */
function defaultAction(row: ImportPreviewRow): ImportDecision["action"] {
  return row.outcome === "import" ? "import" : "skip";
}

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
    const result = await apiCall<ImportPreview>("/api/imports/preview", { method: "POST", body: formFor(target, nextMapping) });
    if (id !== requestId.current) return; // stariji odgovor — ignoriši
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const data = result.data;
    setPreview(data);
    setMapping(data.mapping);
    setDecisions(Object.fromEntries(data.rows.map((row) => [row.rowNumber, defaultAction(row)])));
    setStep(2);
    if (id === requestId.current) setBusy(null);
  }

  async function apply() {
    if (!file || !preview) return;
    setBusy("apply");
    setError(null);
    const form = formFor(file, mapping);
    form.set(
      "decisions",
      JSON.stringify(
        Object.entries(decisions).map(([rowNumber, action]) => ({ rowNumber: Number(rowNumber), action })),
      ),
    );
    const result = await apiCall<ImportResult>("/api/imports/apply", { method: "POST", body: form });
    if (result.ok) {
      setResult({ result: result.data, aborted: null });
      setStep(4);
      setBusy(null);
      return;
    }
    // Prekinut uvoz: `data` nosi izvještaj (koji red, zašto), a poruka razlog za čovjeka.
    if (result.data) {
      setResult({ result: result.data, aborted: result.message });
      setStep(4);
      setBusy(null);
      return;
    }
    setError(result.message);
    setBusy(null);
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
      <PageHeader
        title="Uvoz iz Excela"
        subtitle="Spisak radnika ili mašina. Pregled ne mijenja ništa — uvoz se potvrđuje red po red."
        actions={step > 1 ? <Button onClick={reset}>Novi uvoz</Button> : null}
      />

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
          <div className="gx-stack">
            <Segmented
              label="Vrsta uvoza"
              value={kind}
              onChange={(v) => setKind(v as Kind)}
              options={[{ value: "workers", label: "Radnici" }, { value: "equipment", label: "Mašine i vozila" }]}
            />

            <Input label="Datoteka" hint=".xlsx ili .csv, do 5 MB i 5000 redova. Prvi list se čita; ostali se prijavljuju." ref={fileInput}
                id="import-file"
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => {
                  const chosen = event.target.files?.[0] ?? null;
                  setFile(chosen);
                  setPreview(null);
                  setError(null);
                }}
              />

            <p className="gx-page-sub">
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
        <div className="gx-stack">
          <Card>
            <SectionTitle hint={`${preview.fileName} · list „${preview.sheetName}“`}>2. Mapiranje kolona</SectionTitle>
            {preview.blockers.length > 0 ? (
              <div className="gx-mt-3">
                <Alert tone="error" role="alert">
                  <span>
                    Uvoz ne može da krene dok se ne mapira: {preview.blockers.join(" ")}
                  </span>
                </Alert>
              </div>
            ) : null}

            <div className="gx-filters gx-mt-4">
              {fields.map((field) => (
                <Select label={`${field.label}${field.required ? " *" : ""}`}id={`map-${field.key}`}
                    value={mapping[field.key] ?? ""}
                    onChange={(event) => changeMapping(field.key, event.target.value)}
                  >
                    <option value="">— ne uvozi se —</option>
                    {preview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </Select>
              ))}
            </div>

            {preview.notices.length > 0 ? (
              <div className="gx-mt-4">
                <Alert tone="warning">
                  <span>
                    {preview.notices.length === 1
                      ? preview.notices[0]
                      : `Ove kolone nisu uvezene (${preview.notices.length}): ${preview.notices.join(" ")}`}
                  </span>
                </Alert>
              </div>
            ) : null}

            <p className="gx-page-sub gx-mt-3">
              Pregled ne mijenja podatke. Promjena mapiranja ponovo čita isti fajl.
            </p>
          </Card>

          <PreviewTable preview={preview} />

          <div className="gx-inline-flex">
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
        <div className="gx-stack">
          <Card>
            <SectionTitle hint="Ništa se ne prepisuje bez vašeg izbora.">3. Odluke po redu</SectionTitle>
            <p className="gx-page-sub gx-mt-2">
              Redovi sa greškom se ne mogu uvesti — popravite fajl i pokrenite pregled ponovo.
            </p>

            {actionable.length === 0 ? (
              <div className="gx-mt-4">
                <EmptyState
                  title="Nema redova za uvoz"
                  description="Svi redovi imaju grešku ili je fajl prazan."
                  action={<Button onClick={reset}>Izaberite drugi fajl</Button>}
                />
              </div>
            ) : (
              <div className="gx-stack">
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

          <div className="gx-inline-flex">
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
            <span className="gx-page-sub">
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

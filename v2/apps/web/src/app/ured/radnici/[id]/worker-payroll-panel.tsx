"use client";

/**
 * Tab „Obračun“ na kartici radnika (F6, spec 07 §4).
 *
 * Odluke:
 *   1. **Ostatak akontacije je prvi podatak**, ne iznos koji je nekad izdat: dug koji prelazi
 *      u naredni mjesec je ono što računovodstvo mora znati prije sljedećeg obračuna.
 *   2. **Pozajmica traži ratu**, akontacija ne. Bez rate pozajmica se ne bi mogla odbiti
 *      postupno, pa bi cijeli dug pao na prvi mjesec.
 *   3. **Korekcije su vidljive uz radnika**, sa periodom u kojem su nastale i onim u kojem se
 *      primjenjuju — nikad „nestala“ ispravka.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Card, DataTable, Dialog, EmptyState, FormField, Input, Inline, Select, SectionTitle, Skeleton, Stack,
} from "@/components/ui/index";

type Advance = {
  id: string;
  worker_id: string;
  kind: "ADVANCE" | "LOAN";
  amount_cents: number;
  currency_code: string;
  issued_on: string;
  installment_cents: number | null;
  remaining_cents: number;
  note: string | null;
};

type Correction = {
  id: string;
  period_id: string;
  target_period_id: string;
  workday_id: string | null;
  payroll_line_id: string | null;
  delta_hours: number;
  delta_amount_cents: number | null;
  reason: string;
  status: "OPEN" | "APPLIED";
  created_at: string;
};

export function money(cents: number | null): string {
  if (cents === null) return "—";
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

export function WorkerPayrollPanel({
  workerId,
  canManage,
}: {
  workerId: string;
  canManage: boolean;
}) {
  const [advances, setAdvances] = useState<Advance[] | null>(null);
  const [corrections, setCorrections] = useState<Correction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedCorrection, setSelectedCorrection] = useState<Correction | null>(null);

  const load = useCallback(async () => {
    const [advanceResult, correctionResult] = await Promise.all([
      apiCall<{ advances: Advance[] }>(`/api/workers/${workerId}/advances`),
      apiCall<{ corrections: Correction[] }>(`/api/payroll/corrections?worker=${encodeURIComponent(workerId)}`),
    ]);
    if (!advanceResult.ok) setError(advanceResult.message);
    else setAdvances(advanceResult.data.advances);
    if (!correctionResult.ok) setError(correctionResult.message);
    else setCorrections(correctionResult.data.corrections);
  }, [workerId]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (advances === null || corrections === null) return <Skeleton rows={3} />;

  const remaining = advances.reduce((sum, row) => sum + row.remaining_cents, 0);
  const mine = corrections;

  return (
    <Card>
      <Stack>
        <Inline>
          <SectionTitle hint="Akontacije, pozajmice i korekcije">Obračun</SectionTitle>
          {canManage ? <Button onClick={() => setOpen(true)}>Nova akontacija</Button> : null}
        </Inline>

        {notice ? <Alert tone="success">{notice}</Alert> : null}

        <p className="gx-page-sub">
          Ukupan ostatak duga: <strong>{money(remaining)}</strong>. Odbici nikad ne stvaraju
          negativan obračun — naplaćuje se do nule, a ostatak prelazi u naredni mjesec.
        </p>

        <DataTable
          caption="Akontacije i pozajmice"
          rows={advances}
          rowKey={(row) => row.id}
          columns={[
            { key: "kind", header: "Vrsta", cell: (row) => (row.kind === "ADVANCE" ? "Akontacija" : "Pozajmica") },
            { key: "issued", header: "Izdato", cell: (row) => row.issued_on },
            { key: "amount", header: "Iznos", numeric: true, cell: (row) => money(row.amount_cents) },
            {
              key: "installment",
              header: "Rata",
              numeric: true,
              cell: (row) => (row.installment_cents === null ? "—" : money(row.installment_cents)),
            },
            { key: "remaining", header: "Ostatak", numeric: true, cell: (row) => money(row.remaining_cents) },
            { key: "note", header: "Napomena", cell: (row) => row.note ?? "—" },
          ]}
          empty={(
            <EmptyState
              title="Nema akontacija"
              description="Radnik nema izdatih akontacija ni pozajmica."
            />
          )}
        />

        <DataTable
          caption="Korekcije obračuna"
          rows={mine}
          rowKey={(row) => row.id}
          columns={[
            { key: "date", header: "Nastalo", cell: (row) => row.created_at.slice(0, 10) },
            { key: "hours", header: "Razlika sati", numeric: true, cell: (row) => String(row.delta_hours) },
            {
              key: "amount",
              header: "Razlika iznosa",
              numeric: true,
              cell: (row) => money(row.delta_amount_cents),
            },
            { key: "status", header: "Stanje", cell: (row) => (row.status === "OPEN" ? "Otvorena" : "Primijenjena") },
            { key: "reason", header: "Razlog", cell: (row) => row.reason },
            { key: "action", header: "Radnja", cell: (row) => canManage && row.status === "OPEN" && row.delta_amount_cents === null
              ? <Button variant="quiet" onClick={() => setSelectedCorrection(row)}>Potvrdi iznos</Button> : "—" },
          ]}
          empty={(
            <EmptyState
              title="Nema korekcija"
              description="Nijedna izmjena nije pala u zaključan period."
            />
          )}
        />
      </Stack>

      {selectedCorrection ? <CorrectionValueDialog correction={selectedCorrection} onClose={() => setSelectedCorrection(null)}
        onDone={async () => {setSelectedCorrection(null);setNotice("Iznos je potvrđen. Ponovo izračunajte ciljni period.");await load();}} /> : null}

      <AdvanceDialog
        open={open}
        workerId={workerId}
        onClose={() => setOpen(false)}
        onDone={async (message) => {
          setOpen(false);
          setNotice(message);
          await load();
        }}
        onError={setError}
      />
    </Card>
  );
}

function AdvanceDialog({
  open, workerId, onClose, onDone, onError,
}: {
  open: boolean;
  workerId: string;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [kind, setKind] = useState<Advance["kind"]>("ADVANCE");
  const [amount, setAmount] = useState("");
  const [installment, setInstallment] = useState("");
  const [issuedOn, setIssuedOn] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    const result = await apiCall<Advance>(`/api/workers/${workerId}/advances`, jsonBody({
      worker_id: workerId,
      kind,
      amount: amount.trim(),
      issued_on: issuedOn,
      installment: kind === "LOAN" && installment.trim() ? installment.trim() : undefined,
    }));
    setBusy(false);
    if (!result.ok) {
      onError(result.message);
      return;
    }
    await onDone(kind === "ADVANCE" ? "Akontacija je izdata." : "Pozajmica je izdata.");
  };

  return (
    <Dialog onClose={onClose} title="Nova akontacija ili pozajmica">
      <Stack>
        <FormField label="Vrsta">
          <Select value={kind} onChange={(event) => setKind(event.target.value as Advance["kind"])}>
            <option value="ADVANCE">Akontacija (odbija se u mjesecu izdavanja)</option>
            <option value="LOAN">Pozajmica (odbija se u ratama)</option>
          </Select>
        </FormField>
        <FormField label="Iznos (npr. 200.00)">
          <Input value={amount} onChange={(event) => setAmount(event.target.value)} />
        </FormField>
        {kind === "LOAN" ? (
          <FormField label="Rata (npr. 50.00)" hint="Bez rate pozajmica bi pala na prvi mjesec.">
            <Input value={installment} onChange={(event) => setInstallment(event.target.value)} />
          </FormField>
        ) : null}
        <FormField label="Datum izdavanja">
          <Input type="date" value={issuedOn} onChange={(event) => setIssuedOn(event.target.value)} />
        </FormField>
        <Inline>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !amount.trim()}>
            {busy ? "Upisujem…" : "Izdaj"}
          </Button>
          <Button variant="quiet" onClick={onClose}>Otkaži</Button>
        </Inline>
      </Stack>
    </Dialog>
  );
}

function CorrectionValueDialog({correction,onClose,onDone}:{
  correction:Correction;onClose:()=>void;onDone:()=>Promise<void>;
}) {
  const [amount,setAmount]=useState("");
  const [explanation,setExplanation]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const submit=async()=>{
    setBusy(true);setError(null);
    const result=await apiCall<{id:string;amount_cents:string}>("/api/payroll/corrections",jsonBody({
      correction_id:correction.id,amount:amount.trim(),explanation:explanation.trim(),
    }));
    setBusy(false);
    if(!result.ok) {setError(result.message);return;}
    await onDone();
  };
  return <Dialog title="Potvrda iznosa korekcije" onClose={onClose}><Stack>
    <p className="gx-page-sub">{correction.reason} Razlika sati: {correction.delta_hours}. Utvrdite razliku prema starom obračunu i važećim satnicama i parametrima. Negativan iznos umanjuje zaradu.</p>
    {error ? <Alert tone="error">{error}</Alert> : null}
    <FormField label="Potvrđeni iznos (npr. -10.00)"><Input value={amount} onChange={event=>setAmount(event.target.value)} /></FormField>
    <FormField label="Obrazloženje obračuna" hint="Najmanje 10 znakova; ostaje u revizijskom tragu."><Input value={explanation} onChange={event=>setExplanation(event.target.value)} /></FormField>
    <Inline><Button variant="primary" disabled={busy || !amount.trim() || explanation.trim().length<10} onClick={()=>void submit()}>Potvrdi iznos</Button>
      <Button variant="quiet" onClick={onClose}>Otkaži</Button></Inline>
  </Stack></Dialog>;
}

"use client";

/**
 * Dijalozi kartice radnika: cijena, dopust, izdavanje, povrat i „Radnik odlazi“.
 *
 * Izdvojeno iz ekrana jer dijalozi imaju svoja pravila (i svoj `max-lines`): dugme za odlazak
 * ostaje neaktivno dok svaka zadužena stavka nema razlog otpisa — server bi je odbio svakako,
 * ali korisnik ne treba da to otkrije iz greške.
 */
import { useState } from "react";
import { Alert, Button, Dialog, Inline, Input, Select, Textarea } from "@/components/ui/index";
import { RATE_KIND } from "./worker-labels";

const CONDITION: Record<string, string> = { NEW: "Novo", USED: "Korišteno", DAMAGED: "Oštećeno" };

export function RateDialog({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (body: unknown) => void }) {
  const [kind, setKind] = useState("HOURLY");
  const [amount, setAmount] = useState("");
  const [coefficient, setCoefficient] = useState("");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));

  return (
    <Dialog title="Nova cijena" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            kind,
            // Cijena ide u centima; ekran radi u KM i pretvara na granici, ne u bazi.
            amountCents: kind === "COEFFICIENT" ? null : Math.round(Number(amount) * 100),
            coefficient: kind === "COEFFICIENT" ? Number(coefficient) : null,
            validFrom,
          });
        }}
      >
        <Alert tone="info">
          Nova cijena zatvara prethodnu dan prije. Iznos stare cijene se ne mijenja.
        </Alert>
        <Select id="rate-kind" label="Tip" value={kind} onChange={(event) => setKind(event.target.value)}>
          {Object.entries(RATE_KIND).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        {kind === "COEFFICIENT" ? (
          <>
            <Input id="rate-coef" label="Koeficijent" inputMode="decimal" value={coefficient} onChange={(event) => setCoefficient(event.target.value)} required />
          </>
        ) : (
          <>
            <Input id="rate-amount" label="Iznos (KM)" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </>
        )}
        <Input id="rate-from" label="Važi od" type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} required />
        <Inline gap="sm">
          <Button type="button" variant="quiet" onClick={onClose}>Odustani</Button>
          <Button type="submit" disabled={busy}>Upiši cijenu</Button>
        </Inline>
      </form>
    </Dialog>
  );
}

export function LeaveDialog({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (body: unknown) => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [entitled, setEntitled] = useState("20");
  const [carryover, setCarryover] = useState("0");

  return (
    <Dialog title="Pravo na godišnji" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ year: Number(year), daysEntitled: Number(entitled), daysCarryover: Number(carryover) });
        }}
      >
        <Input id="leave-year" label="Godina" inputMode="numeric" value={year} onChange={(event) => setYear(event.target.value)} required />
        <Input id="leave-entitled" label="Dana prava" inputMode="numeric" value={entitled} onChange={(event) => setEntitled(event.target.value)} required />
        <Input id="leave-carry" label="Prenos iz prošle godine" inputMode="numeric" value={carryover} onChange={(event) => setCarryover(event.target.value)} />
        <Inline gap="sm">
          <Button type="button" variant="quiet" onClick={onClose}>Odustani</Button>
          <Button type="submit" disabled={busy}>Upiši</Button>
        </Inline>
      </form>
    </Dialog>
  );
}

export function IssuanceDialog({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (body: unknown) => void }) {
  const [kind, setKind] = useState("PPE");
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [issuedAt, setIssuedAt] = useState(new Date().toISOString().slice(0, 10));

  return (
    <Dialog title="Izdaj opremu" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ itemKind: kind, itemName: name, size: size || null, issuedAt });
        }}
      >
        <Select id="iss-kind" label="Vrsta" value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="PPE">Zaštitna oprema</option>
          <option value="TOOL">Alat</option>
          <option value="DEVICE">Uređaj</option>
          <option value="OTHER">Ostalo</option>
        </Select>
        <Input id="iss-name" label="Stavka" value={name} onChange={(event) => setName(event.target.value)} required />
        <Input id="iss-size" label="Veličina" value={size} onChange={(event) => setSize(event.target.value)} />
        <Input id="iss-date" label="Datum izdavanja" type="date" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} required />
        <Inline gap="sm">
          <Button type="button" variant="quiet" onClick={onClose}>Odustani</Button>
          <Button type="submit" disabled={busy}>Izdaj</Button>
        </Inline>
      </form>
    </Dialog>
  );
}

export function ReturnDialog({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (body: unknown) => void }) {
  const [returnedAt, setReturnedAt] = useState(new Date().toISOString().slice(0, 10));
  const [condition, setCondition] = useState("USED");

  return (
    <Dialog title="Povrat opreme" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ returnedAt, condition });
        }}
      >
        <Input id="ret-date" label="Datum vraćanja" type="date" value={returnedAt} onChange={(event) => setReturnedAt(event.target.value)} required />
        <Select id="ret-cond" label="Stanje" value={condition} onChange={(event) => setCondition(event.target.value)}>
          {Object.entries(CONDITION).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Inline gap="sm">
          <Button type="button" variant="quiet" onClick={onClose}>Odustani</Button>
          <Button type="submit" disabled={busy}>Upiši povrat</Button>
        </Inline>
      </form>
    </Dialog>
  );
}

/**
 * „Radnik odlazi“ — dijalog koji ništa ne pretpostavlja.
 *
 * Ako radnik ima opremu kod sebe, dijalog to kaže PRIJE slanja i traži razlog za svaki otpis.
 * Server bi ga odbio svakako (`WORKER_HAS_ACTIVE_ISSUANCES`), ali korisnik ne treba da to
 * otkrije tek iz greške poslije klika.
 */
export function OffboardDialog({
  busy,
  workerName,
  issuances,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  workerName: string;
  issuances: { id: string; itemName: string }[];
  onClose: () => void;
  onSubmit: (body: unknown) => void;
}) {
  const [endedAt, setEndedAt] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [writtenOff, setWrittenOff] = useState<Record<string, string>>({});
  const allWrittenOff = issuances.every((row) => (writtenOff[row.id] ?? "").trim().length >= 3);

  return (
    <Dialog title="Radnik odlazi" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            endedAt,
            reason,
            writtenOff: Object.entries(writtenOff)
              .filter(([, value]) => value.trim().length >= 3)
              .map(([issuanceId, note]) => ({ issuanceId, reason: note })),
          });
        }}
      >
        <Alert tone="warning">
          Jednom potvrđeno, radi se odjednom: vraća se oprema, gase se dodjele i sesije, deaktivira
          se nalog i radnik. Ako bilo šta ne prođe, ne mijenja se ništa.
        </Alert>
        <p className="text-sm">
          {workerName} prestaje da radi. Predmet: {issuances.length} zaduženih stavki.
        </p>
        <Input id="off-date" label="Zadnji dan rada" type="date" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} required />
        <Textarea
          id="off-reason"
          label="Razlog odlaska"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={10}
          required
          hint="Najmanje 10 znakova — razlog ostaje u historiji radnika."
        />
        {issuances.length > 0 ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Oprema kod radnika — šta se otpisuje?</legend>
            {issuances.map((row) => (
              <div key={row.id}>
                <Input
                  id={`wo-${row.id}`}
                  label={row.itemName}
                  value={writtenOff[row.id] ?? ""}
                  onChange={(event) => setWrittenOff((prev) => ({ ...prev, [row.id]: event.target.value }))}
                  placeholder="Razlog otpisa (npr. izgubljeno na gradilištu)"
                />
              </div>
            ))}
            {!allWrittenOff ? (
              <p className="text-sm opacity-70">
                Svaka stavka mora dobiti razlog otpisa, ili je prvo vratite kroz „Vrati“.
              </p>
            ) : null}
          </fieldset>
        ) : null}
        <Inline gap="sm">
          <Button type="button" variant="quiet" onClick={onClose}>Odustani</Button>
          <Button type="submit" variant="danger" disabled={busy || !allWrittenOff}>
            Potvrdi odlazak
          </Button>
        </Inline>
      </form>
    </Dialog>
  );
}

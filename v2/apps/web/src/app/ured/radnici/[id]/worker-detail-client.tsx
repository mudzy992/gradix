"use client";

/**
 * Kartica radnika — prikaz i akcije (spec 04 §1.1–1.7).
 *
 * Pravila koja ekran sprovodi:
 *  - **Osjetljivo se ne skriva, nego ne dolazi.** Kad `worker.sensitive` nema (korisnik bez
 *    `workers.sensitive.view`), sekcija se ne renderuje uopšte — prazna sekcija bi izgledala
 *    kao „nema podataka“, a to je druga izjava.
 *  - **Cijena se ne prepisuje.** Nova cijena je nova stavka u istoriji; stara ostaje sa svojim
 *    periodom. Ekran zato nikad ne nudi „izmijeni iznos“.
 *  - **Zaduženje se ne briše.** Povrat je datum; red ostaje u tabeli i poslije povrata.
 *  - **Odlazak je dijalog, ne dugme.** Uvijek pokazuje šta će se dogoditi prije nego se dogodi.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import {
  Alert, Button, Card, Chip, DataTable, DescriptionList, EmptyState, Inline, SectionTitle, Stack,
} from "@/components/ui/index";
import {
  IssuanceDialog,
  LeaveDialog,
  OffboardDialog,
  RateDialog,
  ReturnDialog,
} from "./worker-dialogs";
import type { WorkerProfileView } from "@/server/worker-service";
import { RATE_KIND } from "./worker-labels";
import { WorkerPayrollPanel } from "./worker-payroll-panel";
import { formatDate } from "@/format";

type Caps = {
  canManage: boolean;
  /** F6: `payroll.view` — bez nje tab „Obračun“ se ne renderuje (nikad prazna sekcija). */
  canSeePayroll: boolean;
  canManagePayroll: boolean;
  canSeeSensitive: boolean;
  canSeeRates: boolean;
  canManageRates: boolean;
  canManageLeave: boolean;
  canManageIssuances: boolean;
};

type Rates = { rates: { id: string; kind: string; amountCents: string | null; coefficient: string | null; validFrom: string; validTo: string | null }[]; current: { id: string; validFrom: string } | null };
type Leave = { year: number; daysEntitled: string; daysCarryover: string; daysUsed: number; balance: number; usedDates: string[] }[];
type Issuances = { issuances: { id: string; itemKind: string; itemName: string; size: string | null; issuedAt: string; returnedAt: string | null; condition: string }[]; activeCount: number };
type History = { id: string; field: string; oldValue: string | null; newValue: string | null; changedAt: string; changedByName: string | null; reason: string | null }[];

/** Nazivi stanja zaduženja — isti spisak kao u dijalozima, pa živi ovdje gdje se prikazuje. */
const CONDITION: Record<string, string> = { NEW: "Novo", USED: "Korišteno", DAMAGED: "Oštećeno" };

function money(cents: string | null): string {
  if (cents === null) return "—";
  return `${(Number(cents) / 100).toFixed(2)} KM`;
}

export function WorkerDetailClient({
  worker,
  caps,
  rates,
  leave,
  issuances,
  history,
}: {
  worker: WorkerProfileView;
  caps: Caps;
  rates: Rates | null;
  leave: Leave | null;
  issuances: Issuances | null;
  history: History;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dialog, setDialog] = useState<"rate" | "leave" | "issuance" | "offboard" | "return" | null>(null);
  const [busy, setBusy] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);

  async function submit(action: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.message ?? "Radnja nije uspjela." });
      return;
    }
    setMessage({ tone: "success", text: success });
    setDialog(null);
    router.refresh();
  }

  const activeIssuances = issuances?.issuances.filter((row) => row.returnedAt === null) ?? [];

  return (
    <Stack gap="lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {worker.firstName} {worker.middleName ? `${worker.middleName} ` : ""}
            {worker.lastName}
          </h1>
          <p className="mt-1 text-sm opacity-70">
            {worker.jobTitle ?? "Bez radnog mjesta"}
            {worker.team ? ` · ${worker.team}` : ""}
          </p>
        </div>
        <Inline gap="sm">
          <Chip tone={worker.isActive ? "full" : "hollow"}>{worker.isActive ? "Aktivan" : "Neaktivan"}</Chip>
          {worker.endedAt ? <span className="text-sm opacity-70">Otišao {formatDate(worker.endedAt)}</span> : null}
          {caps.canManage && worker.isActive ? (
            <Button variant="danger" onClick={() => setDialog("offboard")}>
              Radnik odlazi
            </Button>
          ) : null}
        </Inline>
      </div>

      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      <Card>
        <SectionTitle>Podaci</SectionTitle>
        <DescriptionList
          items={[
            { term: "Ugovor", value: worker.engagement },
            { term: "Od", value: formatDate(worker.hiredAt) },
            { term: "Telefon", value: worker.phone ?? "—" },
            { term: "Email", value: worker.email ?? "—" },
            { term: "Nadređeni", value: worker.supervisorName ?? "—" },
            { term: "Nalog", value: worker.userId ? "Povezan" : "Nema nalog" },
            { term: "Radno mjesto", value: worker.jobTitle ?? "—" },
            { term: "Profesija", value: worker.profession ?? "—" },
            { term: "Vozačka", value: worker.drivingCategories.join(", ") || "—" },
          ]}
        />
      </Card>

      {/*
        Osjetljivo: sekcija postoji samo ako je `sensitive` stigao. `null` znači „ne smiješ“,
        ne „nema“, pa se tada ne prikazuje ni naslov — ništa ne odaje da polja postoje.
      */}
      {worker.sensitive ? (
        <Card>
          <SectionTitle>Lični podaci</SectionTitle>
          <DescriptionList
            items={[
              { term: "Datum rođenja", value: worker.sensitive.birthDate ? formatDate(worker.sensitive.birthDate) : "—" },
              { term: "Adresa", value: worker.sensitive.address ?? "—" },
              { term: "Krvna grupa", value: worker.sensitive.bloodType ?? "—" },
              {
                term: "Kontakt u nuždi",
                value: worker.sensitive.emergencyContactName
                  ? `${worker.sensitive.emergencyContactName}${worker.sensitive.emergencyContactPhone ? ` · ${worker.sensitive.emergencyContactPhone}` : ""}`
                  : "—",
              },
              { term: "Veličina obuće", value: worker.shoeSize === null ? "—" : String(worker.shoeSize) },
              { term: "Veličina odjeće", value: worker.clothingSize ?? "—" },
            ]}
          />
        </Card>
      ) : null}

      {caps.canSeeRates ? (
        <Card>
          <SectionTitle
            hint={rates?.current ? `Važi od ${formatDate(rates.current.validFrom)}` : "Nema važeće cijene"}
            action={
              caps.canManageRates ? (
                <Button onClick={() => setDialog("rate")}>Nova cijena</Button>
              ) : null
            }
          >
            Cijene rada
          </SectionTitle>
          {rates && rates.rates.length > 0 ? (
            <DataTable
              caption="Istorija cijena rada"
              rowKey={(rate) => rate.id}
              rows={rates.rates}
              columns={[
                { key: "kind", header: "Tip", cell: (rate) => RATE_KIND[rate.kind] ?? rate.kind },
                {
                  key: "amount",
                  header: "Iznos",
                  cell: (rate) => (rate.coefficient ? `× ${rate.coefficient}` : money(rate.amountCents)),
                },
                { key: "from", header: "Od", cell: (rate) => formatDate(rate.validFrom) },
                { key: "to", header: "Do", cell: (rate) => (rate.validTo ? formatDate(rate.validTo) : "važi") },
              ]}
            />
          ) : (
            <EmptyState title="Nema upisane cijene" description="Dodajte prvu cijenu; stara se nikad ne prepisuje." />
          )}
        </Card>
      ) : null}

      {leave ? (
        <Card>
          <SectionTitle
            action={caps.canManageLeave ? <Button onClick={() => setDialog("leave")}>Upiši pravo</Button> : null}
          >
            Godišnji odmor
          </SectionTitle>
          {leave.length > 0 ? (
            <DataTable
              caption="Saldo godišnjeg odmora po godini"
              rowKey={(year) => String(year.year)}
              rows={leave}
              columns={[
                { key: "year", header: "Godina", cell: (year) => year.year },
                { key: "entitled", header: "Pravo", cell: (year) => year.daysEntitled },
                { key: "carry", header: "Prenos", cell: (year) => year.daysCarryover },
                { key: "used", header: "Iskorišteno", cell: (year) => year.daysUsed },
                {
                  key: "balance",
                  header: "Saldo",
                  // Saldo može biti negativan (više uzeo nego ima pravo) — to se vidi, ne skriva.
                  cell: (year) => <Chip tone={year.balance < 0 ? "hot" : "hollow"}>{year.balance} dana</Chip>,
                },
              ]}
            />
          ) : (
            <EmptyState title="Saldo nije upisan" description="Bez upisanog prava saldo se ne može izračunati." />
          )}
        </Card>
      ) : null}

      {issuances ? (
        <Card>
          <SectionTitle
            hint={`${issuances.activeCount} kod radnika`}
            action={caps.canManageIssuances ? <Button onClick={() => setDialog("issuance")}>Izdaj opremu</Button> : null}
          >
            Zaduženja
          </SectionTitle>
          {issuances.issuances.length > 0 ? (
            <DataTable
              caption="Zaduženja radnika"
              rowKey={(row) => row.id}
              rows={issuances.issuances}
              columns={[
                { key: "item", header: "Stavka", cell: (row) => row.itemName },
                { key: "size", header: "Veličina", cell: (row) => row.size ?? "—" },
                { key: "issued", header: "Izdato", cell: (row) => formatDate(row.issuedAt) },
                {
                  key: "condition",
                  header: "Stanje",
                  cell: (row) => (
                    <Chip tone={row.condition === "DAMAGED" ? "hot" : "hollow"}>
                      {CONDITION[row.condition] ?? row.condition}
                    </Chip>
                  ),
                },
                {
                  key: "returned",
                  header: "Vraćeno",
                  cell: (row) =>
                    row.returnedAt ? formatDate(row.returnedAt) : <Chip tone="hollow">Kod radnika</Chip>,
                },
                {
                  key: "actions",
                  header: "Radnje",
                  // Povrat je akcija samo za ono što je još kod radnika — vraćeno se ne vraća opet.
                  cell: (row) =>
                    row.returnedAt === null && caps.canManageIssuances ? (
                      <Button
                        variant="quiet"
                        onClick={() => {
                          setReturningId(row.id);
                          setDialog("return");
                        }}
                      >
                        Vrati
                      </Button>
                    ) : null,
                },
              ]}
            />
          ) : (
            <EmptyState title="Nema zaduženja" description="Radnik trenutno nema opremu kod sebe." />
          )}
        </Card>
      ) : null}

      {/* F6: obračun živi na kartici radnika, jer se pitanje „koliko mu je ostatak duga“ postavlja
          tu, a ne u mjesečnom periodu. Tab se ne renderuje bez `payroll.view`. */}
      {caps.canSeePayroll ? (
        <WorkerPayrollPanel workerId={worker.id} canManage={caps.canManagePayroll} />
      ) : null}

      <Card>
        <SectionTitle hint="Čitljiva linija, ne pravni trag">Historija izmjena</SectionTitle>
        {history.length > 0 ? (
          <ul className="gx-timeline text-sm">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className="font-medium">{entry.field}</span>{" "}
                {entry.oldValue ?? "—"} → {entry.newValue ?? "—"}
                <span className="opacity-70">
                  {" "}
                  · {formatDate(entry.changedAt)}
                  {entry.changedByName ? ` · ${entry.changedByName}` : ""}
                </span>
                {entry.reason ? <div className="opacity-70">{entry.reason}</div> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nema izmjena" description="Kartica nije mijenjana od kreiranja." />
        )}
      </Card>

      {dialog === "rate" ? (
        <RateDialog busy={busy} onClose={() => setDialog(null)} onSubmit={(body) => submit(() => apiCall(`/api/workers/${worker.id}/rates`, jsonBody(body)), "Cijena je upisana.")} />
      ) : null}

      {dialog === "leave" ? (
        <LeaveDialog busy={busy} onClose={() => setDialog(null)} onSubmit={(body) => submit(() => apiCall(`/api/workers/${worker.id}/leave`, jsonBody(body)), "Pravo je upisano.")} />
      ) : null}

      {dialog === "issuance" ? (
        <IssuanceDialog busy={busy} onClose={() => setDialog(null)} onSubmit={(body) => submit(() => apiCall(`/api/workers/${worker.id}/issuances`, jsonBody(body)), "Oprema je izdata.")} />
      ) : null}

      {dialog === "return" && returningId ? (
        <ReturnDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(body) =>
            submit(
              () => apiCall(`/api/workers/${worker.id}/issuances/${returningId}/return`, { ...patchBody(body) }),
              "Povrat je upisan.",
            )
          }
        />
      ) : null}

      {dialog === "offboard" ? (
        <OffboardDialog
          busy={busy}
          workerName={`${worker.firstName} ${worker.lastName}`}
          issuances={activeIssuances}
          onClose={() => setDialog(null)}
          onSubmit={(body) =>
            submit(
              () => apiCall(`/api/workers/${worker.id}/offboard`, jsonBody(body)),
              "Radnik je razdužen i deaktiviran.",
            )
          }
        />
      ) : null}
    </Stack>
  );
}


"use client";

/**
 * Operator: lista firmi + suspend/aktivacija + vremenski ograničen support pristup.
 *
 * Tri stvari koje ekran namjerno radi:
 *   1. **Suspend traži razlog i potvrdu.** To nije „sakrij red“ — firma prestaje da radi.
 *   2. **Support pristup ima brojač minuta u samom dijalogu** (5–60), jer „sat vremena“
 *      nije isto kao „do kraja dana“; pristup sam ističe i ne može se produžiti ćutanjem.
 *   3. **Razlog je obavezan i vidljiv u auditu firme** — operator zna da ga vlasnik firme
 *      može pročitati, pa se pristup ne traži „onako“.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiCall } from "@/api-client";
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  DataTable,
  EmptyState,
  FormGrid,
  Input,
  Skeleton,
  Stack,
  Textarea,
  type DataColumn,
} from "@/components/ui/index";

type Firm = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  isActive: boolean;
  usersCount: number;
  createdAt: string;
  supportAccessUntil: string | null;
};

type Action = { firm: Firm; kind: "suspend" | "activate" | "support" } | null;

const dateFormat = new Intl.DateTimeFormat("bs-BA", { day: "2-digit", month: "2-digit", year: "numeric" });

export default function FirmiClient({ operatorEmail }: { operatorEmail: string }) {
  const [rows, setRows] = useState<Firm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await apiCall<{ companies: Firm[] }>("/api/platform/companies");
    if (result.ok) {
      setRows(result.data.companies);
      setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (firm: Firm, kind: "suspend" | "activate" | "support") => {
    setAction({ firm, kind });
    setReason("");
    setMinutes("30");
    setError(null);
  };

  const submit = async () => {
    if (!action) return;
    const suffix = action.kind === "suspend" ? "suspend" : action.kind === "activate" ? "activate" : "support-access";
    const body =
      action.kind === "support"
        ? { minutes: Number(minutes), reason: reason.trim() }
        : { reason: reason.trim() };

    setBusy(true);
    const result = await apiCall<{ company?: Firm; supportAccessUntil?: string }>(
      `/api/platform/companies/${action.firm.id}/${suffix}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(
      action.kind === "suspend"
        ? `${action.firm.name} je suspendovana. Podaci su sačuvani, prijave su blokirane.`
        : action.kind === "activate"
          ? `${action.firm.name} je ponovo aktivna.`
          : `Support pristup odobren do ${result.data.supportAccessUntil ? dateFormat.format(new Date(result.data.supportAccessUntil)) : "isteka"}. Upisan je u audit firme.`,
    );
    setAction(null);
    void load();
  };

  const columns: DataColumn<Firm>[] = [
    { key: "name", header: "Firma", cell: (row) => row.name },
    { key: "slug", header: "Identifikator", cell: (row) => <code>{row.slug}</code> },
    { key: "city", header: "Grad", cell: (row) => row.city ?? "—" },
    { key: "users", header: "Korisnika", cell: (row) => String(row.usersCount), numeric: true },
    {
      key: "status",
      header: "Status",
      cell: (row) =>
        row.isActive ? (
          <Chip tone="full">Aktivna</Chip>
        ) : (
          <Chip tone="hollow">Suspendovana</Chip>
        ),
    },
    {
      key: "support",
      header: "Support",
      cell: (row) => (row.supportAccessUntil ? <Badge tone="danger">do {dateFormat.format(new Date(row.supportAccessUntil))}</Badge> : "—"),
    },
  ];

  const reasonOk = reason.trim().length >= 10;
  const minutesNum = Number(minutes);
  const minutesOk = Number.isFinite(minutesNum) && minutesNum >= 5 && minutesNum <= 60;

  return (
    <Stack>
      <div className="gx-section-head">
        <div className="gx-section-head__text">
          <h2 className="gx-section-title">Firme</h2>
          <span className="gx-section-hint">Prijavljeni operator: {operatorEmail}</span>
        </div>
        <Link className="gx-btn gx-btn--primary" href="/platform/firme/nova">
          Nova firma
        </Link>
      </div>

      {error ? (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        {loading ? (
          <Skeleton rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState title="Nema firmi" description="Onboarding kreira prvu firmu i vlasnika naloga." />
        ) : (
          <DataTable
            caption="Firme na platformi"
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            actions={(row) => [
              ...(row.isActive
                ? [{ key: "suspend", label: "Suspenduj", danger: true, onSelect: () => open(row, "suspend") }]
                : [{ key: "activate", label: "Aktiviraj", onSelect: () => open(row, "activate") }]),
              { key: "support", label: "Support pristup", onSelect: () => open(row, "support") },
            ]}
            rowActionLabel={(row) => `Radnje za ${row.name}`}
          />
        )}
      </Card>

      {action ? (
        <Card>
          <Stack>
            <strong>
              {action.kind === "suspend"
                ? `Suspendovati „${action.firm.name}“?`
                : action.kind === "activate"
                  ? `Aktivirati „${action.firm.name}“?`
                  : `Support pristup za „${action.firm.name}“`}
            </strong>
            <p className="gx-muted">
              {action.kind === "suspend"
                ? "Korisnici ne mogu da se prijave. Podaci ostaju netaknuti i vraćaju se aktivacijom."
                : action.kind === "activate"
                  ? "Prijave su ponovo dozvoljene sa važećim lozinkama."
                  : "Pristup ističe sam; razlog ide u audit trag firme i vlasnik ga vidi."}
            </p>

            {action.kind === "support" ? (
              <FormGrid>
                <Input
                  label="Trajanje (minuta, 5–60)"
                  type="number"
                  min="5"
                  max="60"
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                  invalid={!minutesOk}
                />
              </FormGrid>
            ) : null}

            <Textarea
              label="Razlog (najmanje 10 znakova)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              hint={`Razlog: ${reason.trim().length}/10 znakova`}
            />

            <Stack>
              <Button
                variant="primary"
                onClick={() => void submit()}
                disabled={busy || !reasonOk || (action.kind === "support" && !minutesOk)}
              >
                {action.kind === "suspend" ? "Suspenduj" : action.kind === "activate" ? "Aktiviraj" : "Odobri pristup"}
              </Button>
              <Button variant="quiet" onClick={() => setAction(null)} disabled={busy}>
                Odustani
              </Button>
            </Stack>
          </Stack>
        </Card>
      ) : null}
    </Stack>
  );
}

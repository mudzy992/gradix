"use client";

/**
 * Postavke firme — 4 taba (spec 01 §4).
 *
 * Tri odluke koje ekran nosi:
 *   1. **Izmjena traži potvrdu** (`ConfirmDialog`): prag prekovremenog i noćni prozor mijenjaju
 *      obračun sati, pa „slučajan“ klik mora stati. Čitanje je slobodno, pisanje nije.
 *   2. **Praznici su kalendar, ne tabela brojeva**: „prenesena radna subota“ je posebna oznaka
 *      jer bez nje obračun ne zna da je subota bila radna.
 *   3. **2FA stanje je vidljivo u svakom trenutku** u tabu Sigurnost: obavezna rola bez 2FA
 *      ne smije otkriti to tek pri sljedećoj prijavi.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall } from "@/api-client";
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  FormGrid,
  FormSection,
  Input,
  Select,
  Skeleton,
  Stack,
  Switch,
  Tabs,
} from "@/components/ui/index";
import { PrazniciTab } from "./praznici-tab";
import { SigurnostTab } from "./sigurnost-tab";

type Company = {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  taxId: string | null;
  vatId: string | null;
  vatRegistered: boolean;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  web: string | null;
  iban: string | null;
  bankName: string | null;
  currency: string;
  locale: string;
  timezone: string;
  weekStart: "MON" | "SUN";
  workdayHours: number;
  overtimeDailyThreshold: number;
  nightFrom: string | null;
  nightTo: string | null;
  holidayPaid: boolean;
  approvalThreshold: string | null;
  approvalThresholdCurrency: string | null;
  isActive: boolean;
  settingsUpdatedAt: string | null;
};

const TABS = [
  { key: "osnovno", label: "Podaci firme" },
  { key: "rad", label: "Rad i obračun" },
  { key: "praznici", label: "Praznici" },
  { key: "sigurnost", label: "Sigurnost i 2FA" },
];


export default function PostavkeClient({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState("osnovno");
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await apiCall<{ company: Company }>("/api/company");
    if (result.ok) {
      setCompany(result.data.company);
      setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Stack>
      <Tabs tabs={TABS} active={tab} onChange={setTab} label="Postavke firme" />

      {error ? <Alert tone="error">
          <strong>Postavke nisu učitane.</strong> {error}</Alert> : null}
      {saved ? <Alert tone="success">
          <strong>Sačuvano.</strong> {saved}</Alert> : null}

      {loading || !company ? (
        <Skeleton rows={6} />
      ) : tab === "osnovno" ? (
        <Osnovno company={company} canManage={canManage} onSaved={(message) => { setSaved(message); void load(); }} />
      ) : tab === "rad" ? (
        <Rad company={company} canManage={canManage} onSaved={(message) => { setSaved(message); void load(); }} />
      ) : tab === "praznici" ? (
        <PrazniciTab canManage={canManage} />
      ) : (
        <SigurnostTab />
      )}
    </Stack>
  );
}

/* ------------------------------------------------------------------ Osnovno */

function Osnovno({
  company,
  canManage,
  onSaved,
}: {
  company: Company;
  canManage: boolean;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: company.name,
    legalName: company.legalName ?? "",
    taxId: company.taxId ?? "",
    vatId: company.vatId ?? "",
    vatRegistered: company.vatRegistered,
    address: company.address ?? "",
    city: company.city ?? "",
    postalCode: company.postalCode ?? "",
    country: company.country,
    phone: company.phone ?? "",
    email: company.email ?? "",
    web: company.web ?? "",
    iban: company.iban ?? "",
    bankName: company.bankName ?? "",
  });
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    const patch = Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value === "" ? null : value]),
    );
    const result = await apiCall<{ company: Company }>("/api/company", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved("Podaci firme su sačuvani. Izmjena je u audit tragu.");
  };

  return (
    <Card>
      <FormSection title="Identitet i kontakt">
        <FormGrid>
          <Input label="Naziv firme" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={!canManage} />
          <Input label="Puni naziv (za dokumente)" value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} disabled={!canManage} />
          <Input label="PIB / poreski broj" value={form.taxId} onChange={(event) => setForm({ ...form, taxId: event.target.value })} disabled={!canManage} />
          <Input label="PDV broj" value={form.vatId} onChange={(event) => setForm({ ...form, vatId: event.target.value })} disabled={!canManage} />
          <Input label="Adresa" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} disabled={!canManage} />
          <Input label="Grad" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} disabled={!canManage} />
          <Input label="Poštanski broj" value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} disabled={!canManage} />
          <Input label="Država (BA, HR, RS…)" value={form.country} maxLength={2} onChange={(event) => setForm({ ...form, country: event.target.value.toUpperCase() })} disabled={!canManage} />
          <Input label="Telefon" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} disabled={!canManage} />
          <Input label="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} disabled={!canManage} />
          <Input label="Web" value={form.web} onChange={(event) => setForm({ ...form, web: event.target.value })} disabled={!canManage} />
        </FormGrid>
        <Switch
          label="PDV obveznik"
          checked={form.vatRegistered}
          onChange={(event) => setForm({ ...form, vatRegistered: event.target.checked })}
          disabled={!canManage}
        />
      </FormSection>

      <FormSection title="Zaglavlje za izvoz i fakture">
        <FormGrid>
          <Input label="IBAN" value={form.iban} onChange={(event) => setForm({ ...form, iban: event.target.value })} disabled={!canManage} />
          <Input label="Banka" value={form.bankName} onChange={(event) => setForm({ ...form, bankName: event.target.value })} disabled={!canManage} />
        </FormGrid>
        <p className="gx-muted">
          Identifikator firme (<code>{company.slug}</code>) se ne mijenja — to je adresa tenanta, ne naziv.
        </p>
      </FormSection>

      {error ? <Alert tone="error">
          <strong>Nije sačuvano.</strong> {error}</Alert> : null}
      {canManage ? (
        <Button onClick={() => setConfirming(true)} disabled={busy}>
          Sačuvaj podatke
        </Button>
      ) : (
        <p className="gx-muted">Postavke mijenja vlasnik ili administrator.</p>
      )}

      <ConfirmDialog
        open={confirming}
        title="Sačuvati podatke firme?"
        text="Izmjena ide u audit trag sa starim i novim vrijednostima."
        confirmLabel="Sačuvaj"
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}

/* ---------------------------------------------------------------- Rad i obračun */

function Rad({
  company,
  canManage,
  onSaved,
}: {
  company: Company;
  canManage: boolean;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({
    weekStart: company.weekStart,
    workdayHours: String(company.workdayHours),
    overtimeDailyThreshold: String(company.overtimeDailyThreshold),
    nightFrom: company.nightFrom ?? "",
    nightTo: company.nightTo ?? "",
    holidayPaid: company.holidayPaid,
    approvalThreshold: company.approvalThreshold ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nightIncomplete = (form.nightFrom === "") !== (form.nightTo === "");

  const save = async () => {
    if (nightIncomplete) {
      setError("Noćni rad traži i početak i kraj (ili ostavite oba prazna).");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiCall<{ company: Company }>("/api/company", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        weekStart: form.weekStart,
        workdayHours: Number(form.workdayHours),
        overtimeDailyThreshold: Number(form.overtimeDailyThreshold),
        nightFrom: form.nightFrom || null,
        nightTo: form.nightTo || null,
        holidayPaid: form.holidayPaid,
        approvalThreshold: form.approvalThreshold || null,
        ...(form.approvalThreshold ? { approvalThresholdCurrency: company.currency } : {}),
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved("Rad i obračun su sačuvani. Novi obračun koristi ove vrijednosti; stari ostaju kakvi su bili.");
  };

  return (
    <Card>
      <FormSection title="Radna sedmica i sati">
        <FormGrid>
          <Select
            label="Prvi dan sedmice"
            value={form.weekStart}
            onChange={(event) => setForm({ ...form, weekStart: event.target.value as "MON" | "SUN" })}
            disabled={!canManage}
          >
            <option value="MON">Ponedjeljak</option>
            <option value="SUN">Nedjelja</option>
          </Select>
          <Input
            label="Radno vrijeme (sati/dan)"
            type="number"
            step="0.25"
            min="0.5"
            max="24"
            value={form.workdayHours}
            onChange={(event) => setForm({ ...form, workdayHours: event.target.value })}
            disabled={!canManage}
            hint="Iznad ovoga počinje prekovremeno."
          />
          <Input
            label="Dnevni prag prekovremenog"
            type="number"
            step="0.25"
            min="0"
            max="24"
            value={form.overtimeDailyThreshold}
            onChange={(event) => setForm({ ...form, overtimeDailyThreshold: event.target.value })}
            disabled={!canManage}
          />
          <Input
            label="Noćni rad od"
            type="time"
            value={form.nightFrom}
            onChange={(event) => setForm({ ...form, nightFrom: event.target.value })}
            disabled={!canManage}
            invalid={nightIncomplete}
          />
          <Input
            label="Noćni rad do"
            type="time"
            value={form.nightTo}
            onChange={(event) => setForm({ ...form, nightTo: event.target.value })}
            disabled={!canManage}
            invalid={nightIncomplete}
          />
          <Input
            label={`Prag odobrenja (${company.currency})`}
            value={form.approvalThreshold}
            onChange={(event) => setForm({ ...form, approvalThreshold: event.target.value })}
            disabled={!canManage}
            hint="Iznos iznad kojeg trošak traži odobrenje. Prazno = bez praga."
          />
        </FormGrid>
        <Switch
          label="Praznik se plaća"
          checked={form.holidayPaid}
          onChange={(event) => setForm({ ...form, holidayPaid: event.target.checked })}
          disabled={!canManage}
        />
      </FormSection>

      {error ? <Alert tone="error">
          <strong>Nije sačuvano.</strong> {error}</Alert> : null}
      {canManage ? (
        <Button onClick={() => void save()} disabled={busy}>
          Sačuvaj pravila
        </Button>
      ) : (
        <p className="gx-muted">Pravila obračuna mijenja vlasnik ili administrator.</p>
      )}
    </Card>
  );
}

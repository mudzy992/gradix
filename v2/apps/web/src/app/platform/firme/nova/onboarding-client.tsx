"use client";

/**
 * Onboarding ČAROBNJAK (spec 01 §4.2), 3 koraka: firma → vlasnik → potvrda.
 *
 * Zašto čarobnjak, a ne jedan dug obrazac: firma + vlasnik + audit su JEDNA transakcija.
 * Ako vlasnik ne prođe (email već postoji u drugoj firmi), firma ne smije ostati napola
 * napravljena. Zato se sve šalje na kraju, a koraci služe da se greška vidi prije slanja.
 *
 * Link za pozivnicu se prikazuje **jednom** — token se ne čuva u čitljivom obliku.
 */
import { useState } from "react";
import Link from "next/link";
import { apiCall } from "@/api-client";
import {
  Alert,
  Badge,
  Button,
  Card,
  FormGrid,
  FormSection,
  Input,
  Stack,
  Stepper,
  Textarea,
} from "@/components/ui/index";

type Created = {
  company: { id: string; name: string; slug: string };
  owner: { mode: "existing" | "invited"; email: string };
  inviteLink: string | null;
  seededCategories: number;
};

const STEPS = ["Firma", "Vlasnik", "Potvrda"];

export default function OnboardingClient() {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const [firm, setFirm] = useState({
    name: "",
    slug: "",
    city: "",
    taxId: "",
    email: "",
    phone: "",
  });
  const [owner, setOwner] = useState({ email: "", fullName: "" });
  const [note, setNote] = useState("");

  const slugFromName = (name: string) =>
    name
      .toLowerCase()
      .replace(/[đ]/g, "d")
      .replace(/[čć]/g, "c")
      .replace(/[š]/g, "s")
      .replace(/[ž]/g, "z")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);

  const create = async () => {
    setBusy(true);
    setError(null);
    const result = await apiCall<Created>("/api/platform/companies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: firm.name.trim(),
        slug: firm.slug.trim() || slugFromName(firm.name),
        city: firm.city.trim() || null,
        taxId: firm.taxId.trim() || null,
        email: firm.email.trim() || null,
        phone: firm.phone.trim() || null,
        ownerEmail: owner.email.trim().toLowerCase(),
        ownerFullName: owner.fullName.trim() || null,
        note: note.trim() || null,
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCreated(result.data);
    setStep(2);
  };

  if (created) {
    return (
      <Stack>
        <Alert tone="success">
          <strong>Firma „{created.company.name}“ je napravljena.</strong> Identifikator{" "}
          <code>{created.company.slug}</code>, zadanih kategorija mehanizacije: {created.seededCategories}.
        </Alert>
        <Card>
          <FormSection title="Vlasnik naloga">
            {created.owner.mode === "existing" ? (
              <p>
                <Badge tone="primary">Postojeći korisnik</Badge> {created.owner.email} je dobio rolu
                vlasnika u novoj firmi. Prijavljuje se svojom postojećom lozinkom.
              </p>
            ) : (
              <Stack>
                <p>
                  <Badge tone="danger">Pozivnica</Badge> Nalog za {created.owner.email} se aktivira
                  linkom. Link se prikazuje samo sada i važi 48 sati:
                </p>
                <code className="gx-code">{created.inviteLink}</code>
                <p className="gx-muted">
                  Pošaljite link vlasniku. Kad ga otvori, postavlja lozinku i uparuje 2FA (obavezno
                  za rolu vlasnika).
                </p>
              </Stack>
            )}
          </FormSection>
          <Link className="gx-btn gx-btn--primary" href="/platform/firme">
            Nazad na listu firmi
          </Link>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack>
      <Stepper steps={STEPS} current={step} />

      {error ? (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      ) : null}

      {step === 0 ? (
        <Card>
          <FormSection title="Podaci firme">
            <FormGrid>
              <Input
                label="Naziv firme"
                value={firm.name}
                onChange={(event) => setFirm({ ...firm, name: event.target.value, slug: slugFromName(event.target.value) })}
              />
              <Input
                label="Identifikator (slug)"
                value={firm.slug}
                onChange={(event) => setFirm({ ...firm, slug: event.target.value })}
                hint="Adresa tenanta; poslije se ne mijenja."
              />
              <Input label="Grad sjedišta" value={firm.city} onChange={(event) => setFirm({ ...firm, city: event.target.value })} />
              <Input label="PIB" value={firm.taxId} onChange={(event) => setFirm({ ...firm, taxId: event.target.value })} />
              <Input label="Email firme" type="email" value={firm.email} onChange={(event) => setFirm({ ...firm, email: event.target.value })} />
              <Input label="Telefon" value={firm.phone} onChange={(event) => setFirm({ ...firm, phone: event.target.value })} />
            </FormGrid>
            <Button variant="primary" onClick={() => setStep(1)} disabled={firm.name.trim().length < 2}>
              Dalje na vlasnika
            </Button>
          </FormSection>
        </Card>
      ) : (
        <Card>
          <FormSection title="Vlasnik naloga">
            <p className="gx-muted">
              Ako email već postoji na platformi, ta osoba dobija rolu vlasnika u novoj firmi i
              zadržava svoju lozinku. Ako ne postoji, kreira se pozivnica od 48 sati.
            </p>
            <FormGrid>
              <Input
                label="Email vlasnika"
                type="email"
                value={owner.email}
                onChange={(event) => setOwner({ ...owner, email: event.target.value })}
              />
              <Input
                label="Ime i prezime (opciono)"
                value={owner.fullName}
                onChange={(event) => setOwner({ ...owner, fullName: event.target.value })}
              />
            </FormGrid>
            <Textarea
              label="Napomena za audit (opciono)"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              hint="Npr. „dogovoreno telefonom, pilot od novembra“."
            />
            <Stack>
              <Button variant="primary" onClick={() => void create()} disabled={busy || !owner.email.includes("@")}>
                Kreiraj firmu i vlasnika
              </Button>
              <Button variant="quiet" onClick={() => setStep(0)} disabled={busy}>
                Nazad
              </Button>
            </Stack>
          </FormSection>
        </Card>
      )}
    </Stack>
  );
}

"use client";

/**
 * Forma radnika — ista za dodavanje i izmjenu.
 *
 * Veza na nalog NIJE dio forme: nalog dira korisnika i traži drugu dozvolu (`users.manage`).
 * Zato je odvojena sekcija sa svojom akcijom, vidljiva samo onome ko smije da je mijenja.
 */
import { useEffect, useState } from "react";
import type { Worker } from "@gradix/contracts";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import { Alert, Button, Dialog, FormField, FormGrid, Input, Select } from "@/components/ui/index";

export type LinkableUser = { id: string; firstName: string; lastName: string; email: string; isActive: boolean };

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  jobTitle: "",
  engagement: "PERMANENT",
  hiredAt: "",
  endedAt: "",
  team: "",
  supervisorId: "",
};

type FormState = typeof EMPTY_FORM;

const fromWorker = (worker: Worker): FormState => ({
  firstName: worker.firstName,
  lastName: worker.lastName,
  phone: worker.phone ?? "",
  email: worker.email ?? "",
  jobTitle: worker.jobTitle ?? "",
  engagement: worker.engagement,
  hiredAt: worker.hiredAt.slice(0, 10),
  endedAt: worker.endedAt ? worker.endedAt.slice(0, 10) : "",
  team: worker.team ?? "",
  supervisorId: worker.supervisorId ?? "",
});

/**
 * Prazna polja se šalju kao `null`, ne kao `""`: baza razlikuje „nema telefon“ od „telefon je
 * prazan string“, a `""` bi u listi izgledao kao podatak koji postoji.
 */
const toPayload = (form: FormState) => ({
  firstName: form.firstName.trim(),
  lastName: form.lastName.trim(),
  phone: form.phone.trim() || null,
  email: form.email.trim() || null,
  jobTitle: form.jobTitle.trim() || null,
  engagement: form.engagement,
  hiredAt: form.hiredAt,
  endedAt: form.endedAt || null,
  team: form.team.trim() || null,
  supervisorId: form.supervisorId || null,
});

export function WorkerDialog({
  worker,
  workers,
  canLinkUser,
  returnFocusTo,
  onSaved,
  onClose,
}: {
  worker: Worker | null;
  workers: Worker[];
  canLinkUser: boolean;
  returnFocusTo: HTMLElement | null;
  onSaved: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(worker ? fromWorker(worker) : EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<LinkableUser[] | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  // Lista naloga se traži samo kad korisnik smije da veže i to tek kad mu zatreba.
  useEffect(() => {
    if (!canLinkUser || !worker) return;
    void (async () => {
      const result = await apiCall<{ users: LinkableUser[] }>("/api/users");
      if (result.ok) setUsers(result.data.users);
    })();
  }, [canLinkUser, worker]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // Nadređeni ne može biti sam sebi — servis bi to odbio, ali izbor ne treba ni da postoji.
  const supervisorOptions = workers.filter((candidate) => candidate.isActive && candidate.id !== worker?.id);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = toPayload(form);
      const result = worker
        ? await apiCall<{ worker: Worker }>(`/api/workers/${worker.id}`, patchBody(payload))
        : await apiCall<{ worker: Worker }>("/api/workers", jsonBody(payload));

      if (!result.ok) {
        // Greška ostaje u dijalogu: forma je još na ekranu, pa se vidi koje polje smeta.
        setError(result.message);
        return;
      }
      await onSaved(
        worker
          ? `${payload.firstName} ${payload.lastName}: izmjene su sačuvane.`
          : `${payload.firstName} ${payload.lastName} je dodan. Nalog se pravi pozivnicom.`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function link(userId: string | null) {
    if (!worker) return;
    setLinkBusy(true);
    setError(null);
    try {
      const result = await apiCall<{ worker: Worker }>(`/api/workers/${worker.id}/link-user`, patchBody({ userId }));
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onSaved(
        userId
          ? "Nalog je povezan. Role i opseg naloga nisu promijenjeni."
          : "Nalog je odvojen od radnika. Radnik i dalje postoji.",
      );
    } finally {
      setLinkBusy(false);
    }
  }

  return (
    <Dialog
      title={worker ? "Izmjena radnika" : "Novi radnik"}
      hint={worker ? "Radnik ne mora imati nalog u aplikaciji." : "Radnik se dodaje bez naloga; nalog se pravi pozivnicom."}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
      wide
    >
      <form onSubmit={save}>
        {error ? (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        ) : null}

        <FormGrid>
          <Input label="Ime" id="worker-first-name" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} required maxLength={100} autoComplete="off" />
          <Input label="Prezime" id="worker-last-name" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} required maxLength={100} autoComplete="off" />
        </FormGrid>
        <FormGrid>
          <Input label="Telefon" id="worker-phone" hint="Nije obavezan. Bez njega radnik i dalje postoji." value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} inputMode="tel" autoComplete="off" placeholder="061 111 222" />
          <Input label="Email" id="worker-email" hint="Za kontakt; nije nalog za prijavu." type="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={200} autoComplete="off" />
        </FormGrid>
        <FormGrid>
          <Input label="Zanimanje" id="worker-job" value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} maxLength={120} placeholder="Zidar, rukovalac, vozač…" />
          <Select label="Angažman" id="worker-engagement" value={form.engagement} onChange={(e) => set("engagement", e.target.value)}>
            <option value="PERMANENT">Stalno</option>
            <option value="FIXED_TERM">Određeno</option>
            <option value="SEASONAL">Sezonski</option>
            <option value="CONTRACT">Ugovor</option>
          </Select>
        </FormGrid>
        <FormGrid>
          <Input label="Datum početka" id="worker-hired" type="date" value={form.hiredAt} onChange={(e) => set("hiredAt", e.target.value)} required />
          <Input label="Datum prestanka" id="worker-ended" hint="Ostavite prazno dok je radnik aktivan." type="date" value={form.endedAt} onChange={(e) => set("endedAt", e.target.value)} min={form.hiredAt || undefined} />
        </FormGrid>
        <FormGrid>
          <Input label="Ekipa" id="worker-team" value={form.team} onChange={(e) => set("team", e.target.value)} maxLength={120} placeholder="Ekipa 1" />
          <Select label="Nadređeni" id="worker-supervisor" value={form.supervisorId} onChange={(e) => set("supervisorId", e.target.value)}>
            <option value="">— nema —</option>
            {supervisorOptions.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.firstName} {candidate.lastName}
              </option>
            ))}
          </Select>
        </FormGrid>

        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Otkaži
          </Button>
          <Button type="submit" variant="primary" fullWidthOnMobile disabled={saving}>
            {saving ? "Čuvam…" : worker ? "Sačuvaj izmjene" : "Dodaj radnika"}
          </Button>
        </div>
      </form>

      {worker && canLinkUser ? (
        <section className="gx-form-section">
          <h3 className="gx-form-section__title">Nalog u aplikaciji</h3>
          <p>Veza ne mijenja role ni opseg. Nalog se pravi u Korisnici, pozivnicom.</p>
          <FormField label="Poveži sa nalogom" htmlFor="worker-link-user">
            <Select
              id="worker-link-user"
              value={worker.userId ?? ""}
              disabled={linkBusy || users === null}
              onChange={(event) => void link(event.target.value || null)}
            >
              <option value="">— bez naloga —</option>
              {(users ?? []).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.firstName} {candidate.lastName} · {candidate.email}
                  {candidate.isActive ? "" : " (neaktivan)"}
                </option>
              ))}
            </Select>
          </FormField>
          {users === null ? <p>Učitavam listu naloga…</p> : null}
        </section>
      ) : null}
    </Dialog>
  );
}

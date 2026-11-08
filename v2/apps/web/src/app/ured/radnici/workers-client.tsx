"use client";

/**
 * Radnici — lista i forma.
 *
 * Pravila koja ekran sprovodi:
 *  - **Radnik nije nalog.** Red prikazuje osobu; veza na nalog je opciona i piše se kao
 *    „Nalog: email“, nikad kao goli id. Bez naloga je uobičajeno stanje, ne greška.
 *  - **Nema brisanja.** Deaktivacija je jedina radnja prekida rada — istorija (angažman,
 *    brojilo mašine koju je vozio) mora ostati čitljiva.
 *  - Jedna kontekstualna akcija po redu („Izmijeni“), ostalo u meniju „⋯“.
 *  - Stanje se nikad ne prenosi samo bojom: chip ima tekst („Aktivan“ / „Neaktivan“).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Worker } from "@gradix/contracts";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import { engagementLabel, formatDate, initialsOf } from "@/format";
import { Dialog } from "@/components/dialog";
import { Alert, Button, Card, Chip, EmptyState, Field, Icon, Skeleton, inputClass } from "@/components/ui";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; workers: Worker[] };

type LinkableUser = { id: string; firstName: string; lastName: string; email: string; isActive: boolean };

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

export default function WorkersClient({
  canManage,
  canLinkUser,
}: {
  canManage: boolean;
  canLinkUser: boolean;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [filter, setFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ worker: Worker | null; returnTo: HTMLElement | null } | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const result = await apiCall<{ workers: Worker[] }>("/api/workers");
    if (!result.ok) {
      setState({ kind: "error", message: result.message });
      return;
    }
    setState({ kind: "ready", workers: result.data.workers });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const workers = state.kind === "ready" ? state.workers : [];
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return workers.filter((worker) => {
      if (!showInactive && !worker.isActive) return false;
      if (needle.length === 0) return true;
      return `${worker.firstName} ${worker.lastName} ${worker.jobTitle ?? ""} ${worker.team ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [workers, filter, showInactive]);

  const inactiveCount = workers.filter((worker) => !worker.isActive).length;

  async function toggleActive(worker: Worker) {
    setBusyId(worker.id);
    try {
      const result = await apiCall<{ worker: Worker }>(
        `/api/workers/${worker.id}/active`,
        patchBody({ active: !worker.isActive }),
      );
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
        return;
      }
      setMessage({
        tone: "success",
        text: worker.isActive
          ? `${worker.firstName} ${worker.lastName} je deaktiviran. Zapis i istorija ostaju.`
          : `${worker.firstName} ${worker.lastName} je ponovo aktivan.`,
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="gx-page-head">
        <div className="gx-page-head__text">
          <h1 className="gx-page-title">Radnici</h1>
          <p className="gx-page-sub">
            Ljudi na gradilištu, kontakt i angažman. Radnik ne mora imati nalog u aplikaciji.
          </p>
        </div>
        {canManage ? (
          <div className="gx-page-head__actions">
            <Button
              variant="primary"
              icon="users"
              onClick={(event) => setEditing({ worker: null, returnTo: event.currentTarget })}
            >
              + Dodaj radnika
            </Button>
          </div>
        ) : null}
      </div>

      {message ? (
        <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </Alert>
      ) : null}

      <Card>
        <div className="gx-filters" style={{ marginBottom: "var(--space-5)" }}>
          <Field label="Traži radnika" htmlFor="worker-filter">
            <input
              id="worker-filter"
              className={inputClass}
              placeholder="Ime, zanimanje ili ekipa"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </Field>
          <div className="gx-check" style={{ paddingBottom: 10 }}>
            <input
              id="worker-show-inactive"
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            <label htmlFor="worker-show-inactive">Prikaži i neaktivne ({inactiveCount})</label>
          </div>
        </div>

        {state.kind === "loading" ? <Skeleton rows={4} /> : null}

        {state.kind === "error" ? (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <Alert tone="error" role="alert">
              {state.message}
            </Alert>
            <div>
              <Button onClick={() => void load()}>Pokušaj ponovo</Button>
            </div>
          </div>
        ) : null}

        {state.kind === "ready" && workers.length === 0 ? (
          <EmptyState
            title="Još nema radnika"
            description="Dodajte prvog radnika ili uvezite spisak iz Excela (Uvoz)."
            action={
              canManage ? (
                <Button
                  variant="primary"
                  onClick={(event) => setEditing({ worker: null, returnTo: event.currentTarget })}
                >
                  + Dodaj radnika
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {state.kind === "ready" && workers.length > 0 && visible.length === 0 ? (
          <EmptyState
            title="Nema radnika koji odgovaraju filteru"
            description={showInactive ? "Promijenite tekst filtera." : "Probajte sa uključenim neaktivnima."}
            action={
              <Button
                onClick={() => {
                  setFilter("");
                  setShowInactive(true);
                }}
              >
                Prikaži sve
              </Button>
            }
          />
        ) : null}

        {visible.length > 0 ? (
          <table className="gx-table gx-table--cards">
            <thead>
              <tr>
                <th>Radnik</th>
                <th>Kontakt</th>
                <th>Angažman</th>
                <th>Od</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((worker) => (
                <WorkerRow
                  key={worker.id}
                  worker={worker}
                  canManage={canManage}
                  busy={busyId === worker.id}
                  onEdit={(returnTo) => setEditing({ worker, returnTo })}
                  onToggle={() => void toggleActive(worker)}
                />
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>

      {editing ? (
        <WorkerDialog
          worker={editing.worker}
          workers={workers}
          canLinkUser={canLinkUser}
          returnFocusTo={editing.returnTo}
          onSaved={async (text) => {
            setEditing(null);
            setMessage({ tone: "success", text });
            await load();
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function WorkerRow({
  worker,
  canManage,
  busy,
  onEdit,
  onToggle,
}: {
  worker: Worker;
  canManage: boolean;
  busy: boolean;
  onEdit: (returnTo: HTMLElement | null) => void;
  onToggle: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <tr>
      <td data-label="Radnik">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span aria-hidden="true" className="gx-avatar">
            {initialsOf(worker.firstName, worker.lastName)}
          </span>
          <span className="gx-who" style={{ fontWeight: 600 }}>
            {worker.firstName} {worker.lastName}
            <span>
              {worker.jobTitle ?? "—"}
              {worker.team ? ` · ${worker.team}` : ""}
            </span>
          </span>
        </div>
      </td>
      <td data-label="Kontakt">
        <div style={{ display: "grid", gap: 2 }}>
          <span className="gx-mono">{worker.phone ?? "—"}</span>
          <span style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>{worker.email ?? "—"}</span>
        </div>
      </td>
      <td data-label="Angažman">{engagementLabel(worker.engagement)}</td>
      <td data-label="Od" style={{ whiteSpace: "nowrap" }}>
        <span className="gx-mono">{formatDate(worker.hiredAt)}</span>
      </td>
      <td data-label="Status">
        <div style={{ display: "grid", gap: 4, justifyItems: "start" }}>
          <Chip tone={worker.isActive ? "full" : "hollow"}>{worker.isActive ? "Aktivan" : "Neaktivan"}</Chip>
          {/* Veza na nalog je podatak, ne status: bez naloga je normalno. */}
          <span style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
            {worker.userEmail ? `Nalog: ${worker.userEmail}` : "Bez naloga"}
          </span>
        </div>
      </td>
      <td data-label="Akcija">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          {canManage ? (
            <Button
              variant="secondary"
              disabled={busy}
              className="whitespace-nowrap"
              onClick={(event) => onEdit(event.currentTarget)}
            >
              Izmijeni
            </Button>
          ) : (
            <span style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>samo pregled</span>
          )}
          {canManage ? (
            <div className="relative">
              <button
                ref={moreButton}
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Više radnji za ${worker.firstName} ${worker.lastName}`}
                onClick={() => setMenuOpen((open) => !open)}
                className="gx-icon-btn"
              >
                <Icon name="more" />
              </button>
              {menuOpen ? (
                <div role="menu" className="gx-menu">
                  <button
                    role="menuitem"
                    type="button"
                    className="gx-menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit(moreButton.current);
                    }}
                  >
                    Izmijeni podatke
                  </button>
                  {worker.email ? (
                    <button
                      role="menuitem"
                      type="button"
                      className="gx-menu-item"
                      onClick={() => {
                        void navigator.clipboard?.writeText(worker.email ?? "");
                        setMenuOpen(false);
                      }}
                    >
                      Kopiraj email
                    </button>
                  ) : null}
                  {worker.phone ? (
                    <button
                      role="menuitem"
                      type="button"
                      className="gx-menu-item"
                      onClick={() => {
                        void navigator.clipboard?.writeText(worker.phone ?? "");
                        setMenuOpen(false);
                      }}
                    >
                      Kopiraj telefon
                    </button>
                  ) : null}
                  <button
                    role="menuitem"
                    type="button"
                    className="gx-menu-item"
                    style={{ color: "var(--danger)" }}
                    onClick={() => {
                      setMenuOpen(false);
                      onToggle();
                    }}
                  >
                    {worker.isActive ? "Deaktiviraj" : "Aktiviraj"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/**
 * Forma radnika — ista za dodavanje i izmjenu.
 *
 * Veza na nalog NIJE dio forme: nalog dira korisnika i traži drugu dozvolu (`users.manage`).
 * Zato je odvojena sekcija sa svojom akcijom, vidljiva samo onome ko smije da je mijenja.
 */
function WorkerDialog({
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
      <form onSubmit={save} style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-5)" }}>
        {error ? (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        ) : null}

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Ime" htmlFor="worker-first-name">
            <input
              id="worker-first-name"
              className={inputClass}
              value={form.firstName}
              onChange={(event) => set("firstName", event.target.value)}
              required
              maxLength={100}
              autoComplete="off"
            />
          </Field>
          <Field label="Prezime" htmlFor="worker-last-name">
            <input
              id="worker-last-name"
              className={inputClass}
              value={form.lastName}
              onChange={(event) => set("lastName", event.target.value)}
              required
              maxLength={100}
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Telefon" htmlFor="worker-phone" hint="Nije obavezan. Bez njega radnik i dalje postoji.">
            <input
              id="worker-phone"
              className={inputClass}
              value={form.phone}
              onChange={(event) => set("phone", event.target.value)}
              maxLength={40}
              inputMode="tel"
              autoComplete="off"
              placeholder="061 111 222"
            />
          </Field>
          <Field label="Email" htmlFor="worker-email" hint="Za kontakt; nije nalog za prijavu.">
            <input
              id="worker-email"
              className={inputClass}
              type="email"
              value={form.email}
              onChange={(event) => set("email", event.target.value)}
              maxLength={200}
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Zanimanje" htmlFor="worker-job">
            <input
              id="worker-job"
              className={inputClass}
              value={form.jobTitle}
              onChange={(event) => set("jobTitle", event.target.value)}
              maxLength={120}
              placeholder="Zidar, rukovalac, vozač…"
            />
          </Field>
          <Field label="Angažman" htmlFor="worker-engagement">
            <select
              id="worker-engagement"
              className={inputClass}
              value={form.engagement}
              onChange={(event) => set("engagement", event.target.value)}
            >
              <option value="PERMANENT">Stalno</option>
              <option value="FIXED_TERM">Određeno</option>
              <option value="SEASONAL">Sezonski</option>
              <option value="CONTRACT">Ugovor</option>
            </select>
          </Field>
        </div>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Datum početka" htmlFor="worker-hired">
            <input
              id="worker-hired"
              className={inputClass}
              type="date"
              value={form.hiredAt}
              onChange={(event) => set("hiredAt", event.target.value)}
              required
            />
          </Field>
          <Field label="Datum prestanka" htmlFor="worker-ended" hint="Ostavite prazno dok je radnik aktivan.">
            <input
              id="worker-ended"
              className={inputClass}
              type="date"
              value={form.endedAt}
              onChange={(event) => set("endedAt", event.target.value)}
              min={form.hiredAt || undefined}
            />
          </Field>
        </div>

        <div className="gx-cols" style={{ gap: "var(--space-4)" }}>
          <Field label="Ekipa" htmlFor="worker-team">
            <input
              id="worker-team"
              className={inputClass}
              value={form.team}
              onChange={(event) => set("team", event.target.value)}
              maxLength={120}
              placeholder="Ekipa 1"
            />
          </Field>
          <Field label="Nadređeni" htmlFor="worker-supervisor">
            <select
              id="worker-supervisor"
              className={inputClass}
              value={form.supervisorId}
              onChange={(event) => set("supervisorId", event.target.value)}
            >
              <option value="">— nema —</option>
              {supervisorOptions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.firstName} {candidate.lastName}
                </option>
              ))}
            </select>
          </Field>
        </div>

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
        <section style={{ marginTop: "var(--space-6)", borderTop: "1px solid var(--line)", paddingTop: "var(--space-5)" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: "var(--space-1)" }}>Nalog u aplikaciji</h3>
          <p style={{ color: "var(--muted)", fontSize: "var(--text-small)", marginBottom: "var(--space-3)" }}>
            Veza ne mijenja role ni opseg. Nalog se pravi u Korisnici, pozivnicom.
          </p>
          <Field label="Poveži sa nalogom" htmlFor="worker-link-user">
            <select
              id="worker-link-user"
              className={inputClass}
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
            </select>
          </Field>
          {users === null ? (
            <p style={{ color: "var(--muted)", fontSize: "var(--text-small)", marginTop: "var(--space-2)" }}>
              Učitavam listu naloga…
            </p>
          ) : null}
        </section>
      ) : null}
    </Dialog>
  );
}

"use client";

/**
 * Lista korisnika — smjer A (gusta tabela) koja se ispod 640 px preliva u kartice.
 *
 * Pravila iz odluke vlasnika:
 *  - nijedna boja nije hardkodirana; sve ide kroz CSS varijable,
 *  - u redu je JEDNA kontekstualna akcija prema stanju osobe, ostalo je u meniju „⋯“,
 *  - primarno dugme je pune širine samo na uskom ekranu (`gx-primary-full`),
 *  - sva stanja postoje: učitavanje, prazno, greška, uspjeh.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, EmptyState, Field, Pill, SectionTitle, Skeleton, inputClass } from "@/components/ui";

export type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: string[];
  scope: string;
  createdAt: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; users: User[] };

type IssuedLink = { link: string; email: string; expiresAt: string } | null;

const ROLE_BS: Record<string, string> = {
  OWNER: "Vlasnik",
  ADMIN: "Administrator",
  PROJECT_MANAGER: "Vođa projekta",
  SITE_SUPERVISOR: "Šef gradilišta",
  WORKER: "Radnik",
  DRIVER: "Vozač",
  MACHINE_OPERATOR: "Rukovalac",
  MECHANIC: "Mehaničar",
  ACCOUNTANT: "Računovođa",
};

const SCOPE_BS: Record<string, string> = {
  COMPANY: "Cijela firma",
  SELF: "Samo svoje",
};

const rolesBs = (roles: string[]) => roles.map((role) => ROLE_BS[role] ?? role).join(", ");
const initials = (user: User) => `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();

/**
 * Datum na bosanskom, bez `Intl`-a: `bs-BA` u Chromiumu daje „2026 M11 7“.
 * Format je `7. 11. 2026.` — isto na svakom pregledniku.
 */
const dateBs = (value: string) => {
  const date = new Date(value);
  return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}.`;
};

const dateTimeBs = (value: string) => {
  const date = new Date(value);
  return `${dateBs(value)} u ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

export default function UsersClient({
  canManage,
  actorId,
  actorIsOwner,
}: {
  canManage: boolean;
  actorId: string;
  actorIsOwner: boolean;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [filter, setFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [issued, setIssued] = useState<IssuedLink>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/users", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setState({ kind: "error", message: body?.error?.message ?? "Ne mogu da učitam listu." });
        return;
      }
      setState({ kind: "ready", users: body.data.users as User[] });
    } catch {
      setState({ kind: "error", message: "Nema veze sa serverom. Provjerite mrežu i pokušajte ponovo." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const users = state.kind === "ready" ? state.users : [];
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return users.filter((user) => {
      const matchesText =
        needle.length === 0 ||
        `${user.firstName} ${user.lastName}`.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle);
      const matchesRole = roleFilter.length === 0 || user.roles.includes(roleFilter);
      return matchesText && matchesRole;
    });
  }, [users, filter, roleFilter]);

  async function issueInvite(formData: FormData) {
    const response = await fetch("/api/users/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: String(formData.get("email") ?? ""),
        roles: [String(formData.get("role") ?? "WORKER")],
        scope: String(formData.get("scope") ?? "COMPANY"),
      }),
    });
    const body = await response.json();
    if (!response.ok || !body.success) {
      setMessage({ tone: "error", text: body?.error?.message ?? "Pozivnica nije napravljena." });
      return;
    }
    setInviteOpen(false);
    setIssued({ link: body.data.link, email: body.data.email, expiresAt: body.data.expiresAt });
    setMessage({ tone: "success", text: "Pozivnica je napravljena. Kopirajte link i pošaljite ga sami." });
    await load();
  }

  async function issueReset(user: User) {
    setBusyId(user.id);
    try {
      const response = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST" });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setMessage({ tone: "error", text: body?.error?.message ?? "Reset nije izdat." });
        return;
      }
      setIssued({ link: body.data.link, email: user.email, expiresAt: body.data.expiresAt });
      setMessage({ tone: "success", text: `Link za ${user.email} je napravljen.` });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(user: User) {
    setBusyId(user.id);
    try {
      const response = await fetch(`/api/users/${user.id}/active`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !user.isActive }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setMessage({ tone: "error", text: body?.error?.message ?? "Izmjena nije prošla." });
        return;
      }
      setMessage({
        tone: "success",
        text: user.isActive
          ? `${user.firstName} je deaktiviran. Sve sesije su ugašene.`
          : `${user.firstName} je ponovo aktivan.`,
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function changeMembership(user: User, roles: string[], scope: string) {
    setBusyId(user.id);
    try {
      const response = await fetch(`/api/users/${user.id}/membership`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roles, scope }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        // Greška ostaje u dijalogu: korisnik treba da vidi šta servis odbija i zašto.
        return body?.error?.message ?? "Izmjena nije prošla.";
      }
      setEditing(null);
      setMessage({
        tone: "success",
        text: `Role i opseg za ${user.firstName} su promijenjeni. Trag je zapisan.`,
      });
      await load();
      return null;
    } catch {
      return "Nema veze sa serverom. Provjerite mrežu.";
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid" style={{ gap: "var(--section-gap)" }}>
      <SectionTitle hint="jedna akcija po osobi, ostalo u „⋯“">Korisnici</SectionTitle>

      {message ? (
        <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </Alert>
      ) : null}
      {issued ? <IssuedLinkCard issued={issued} onClose={() => setIssued(null)} /> : null}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              className={inputClass}
              style={{ maxWidth: 260, minHeight: "var(--control-height)" }}
              placeholder="Traži po imenu ili emailu"
              aria-label="Traži korisnika"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <select
              className={inputClass}
              style={{ maxWidth: 190, minHeight: "var(--control-height)" }}
              aria-label="Filtriraj po roli"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="">Sve role</option>
              {Object.entries(ROLE_BS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {canManage ? (
            <Button variant="primary" fullWidthOnMobile onClick={() => setInviteOpen(true)}>
              + Pozovi osobu
            </Button>
          ) : null}
        </div>

        {state.kind === "loading" ? <Skeleton rows={4} /> : null}

        {state.kind === "error" ? (
          <div className="grid gap-3">
            <Alert tone="error" role="alert">
              {state.message}
            </Alert>
            <div>
              <Button onClick={() => void load()}>Pokušaj ponovo</Button>
            </div>
          </div>
        ) : null}

        {state.kind === "ready" && users.length === 0 ? (
          <EmptyState
            title="U firmi još nema osoba"
            description="Pozovite prvog čovjeka — dobiće link za postavljanje lozinke."
            action={
              canManage ? (
                <Button variant="primary" onClick={() => setInviteOpen(true)}>
                  + Pozovi osobu
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {state.kind === "ready" && users.length > 0 && visible.length === 0 ? (
          <EmptyState
            title="Nema osoba koje odgovaraju filteru"
            description="Obrišite filter ili promijenite rolu."
            action={
              <Button
                onClick={() => {
                  setFilter("");
                  setRoleFilter("");
                }}
              >
                Obriši filter
              </Button>
            }
          />
        ) : null}

        {visible.length > 0 ? (
          <table className="gx-table w-full text-[var(--body-size)]">
            <thead>
              <tr className="border-b-2 border-[var(--color-border)] text-left text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
                <th className="px-3 py-2 font-semibold">Osoba</th>
                <th className="px-3 py-2 font-semibold">Rola</th>
                <th className="px-3 py-2 font-semibold">Opseg</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Dodan</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Akcija</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  canManage={canManage}
                  actorId={actorId}
                  actorIsOwner={actorIsOwner}
                  busy={busyId === user.id}
                  onReset={() => void issueReset(user)}
                  onToggle={() => void toggleActive(user)}
                  onEdit={() => setEditing(user)}
                />
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>

      {inviteOpen ? <InviteDialog onSubmit={issueInvite} onClose={() => setInviteOpen(false)} /> : null}
      {editing ? (
        <MembershipDialog
          user={editing}
          actorIsOwner={actorIsOwner}
          busy={busyId === editing.id}
          onSave={(roles, scope) => changeMembership(editing, roles, scope)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function statusOf(user: User) {
  if (!user.isActive) return { tone: "danger" as const, label: "Deaktiviran" };
  if (user.mustChangePassword) return { tone: "accent" as const, label: "Čeka prvu prijavu" };
  return { tone: "success" as const, label: "Aktivan" };
}

function UserRow({
  user,
  canManage,
  actorId,
  actorIsOwner,
  busy,
  onReset,
  onToggle,
  onEdit,
}: {
  user: User;
  canManage: boolean;
  actorId: string;
  actorIsOwner: boolean;
  busy: boolean;
  onReset: () => void;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const status = statusOf(user);
  /**
   * Server bi ovo odbio (`USERS_TARGET_PROTECTED`), ali dugme koje ne može proći ne treba
   * ni da postoji: vlasnika mijenja samo vlasnik, a sebe niko ne deaktivira.
   */
  const protectedRow = (user.roles.includes("OWNER") && !actorIsOwner) || user.id === actorId;
  const actionable = canManage && !protectedRow;
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  /**
   * Tačno jedna kontekstualna akcija:
   *  - deaktiviran → aktiviraj,
   *  - čeka prvu prijavu → pošalji pozivnicu ponovo,
   *  - aktivan → pošalji reset lozinke.
   */
  const primaryAction = !user.isActive
    ? { label: "Aktiviraj", onClick: onToggle }
    : user.mustChangePassword
      ? { label: "Pošalji pozivnicu", onClick: onReset }
      : { label: "Reset lozinke", onClick: onReset };

  return (
    <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-brand-soft)]">
      <td data-label="Osoba">
        <div className="flex items-center gap-2.5 font-semibold">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--color-accent)] text-[11px] font-extrabold text-[var(--color-text)]"
          >
            {initials(user)}
          </span>
          <span>
            {user.firstName} {user.lastName}
            <br />
            <span className="font-normal text-[var(--color-text-muted)]">{user.email}</span>
          </span>
        </div>
      </td>
      <td data-label="Rola">
        <Pill tone="brand">{rolesBs(user.roles)}</Pill>
      </td>
      <td data-label="Opseg" className="text-[var(--color-text-muted)]">
        {SCOPE_BS[user.scope] ?? user.scope}
      </td>
      <td data-label="Status">
        <Pill tone={status.tone}>{status.label}</Pill>
      </td>
      <td data-label="Dodan" className="whitespace-nowrap text-[var(--color-text-muted)]">
        {dateBs(user.createdAt)}
      </td>
      <td data-label="Akcija">
        <div className="flex flex-nowrap items-center justify-end gap-2">
          {canManage && protectedRow ? (
            <span className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">
              {user.id === actorId ? "vi" : "samo vlasnik"}
            </span>
          ) : null}
          {actionable ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={primaryAction.onClick}
              className="whitespace-nowrap"
            >
              {busy ? "Radim…" : primaryAction.label}
            </Button>
          ) : null}
          {actionable ? (
            <div className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Više radnji za ${user.firstName} ${user.lastName}`}
                onClick={() => setMenuOpen((open) => !open)}
                className="grid place-items-center rounded-[10px] border-2 border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)]"
                style={{ height: "var(--control-height)", width: "var(--control-height)" }}
              >
                ⋯
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-10 mt-1 grid w-56 gap-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg"
                >
                  <button
                    role="menuitem"
                    type="button"
                    className="rounded px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-muted)]"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit();
                    }}
                  >
                    Role i opseg
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    className="rounded px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-muted)]"
                    onClick={() => {
                      void navigator.clipboard?.writeText(user.email);
                      setMenuOpen(false);
                    }}
                  >
                    Kopiraj email
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    className="rounded px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-muted)]"
                    onClick={() => {
                      setMenuOpen(false);
                      onReset();
                    }}
                  >
                    Novi link za lozinku
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    className="rounded px-3 py-2 text-left text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
                    onClick={() => {
                      setMenuOpen(false);
                      onToggle();
                    }}
                  >
                    {user.isActive ? "Deaktiviraj osobu" : "Aktiviraj osobu"}
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

function IssuedLinkCard({ issued, onClose }: { issued: NonNullable<IssuedLink>; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const expires = dateTimeBs(issued.expiresAt);
  return (
    <Card>
      <p className="mb-2 font-semibold">Link za {issued.email}</p>
      <Alert tone="success">Kopirajte link i pošaljite ga sami. Važi do {expires}, jednokratan je.</Alert>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          className={inputClass}
          style={{ minHeight: "var(--control-height)" }}
          readOnly
          value={issued.link}
          aria-label="Link za kopiranje"
        />
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => {
              void navigator.clipboard?.writeText(issued.link);
              setCopied(true);
            }}
          >
            {copied ? "Kopirano" : "Kopiraj link"}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Zatvori
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[13px] text-[var(--color-warning-text)]">
        Ako zatvorite bez kopiranja, link se više ne može prikazati — napravite novi.
      </p>
    </Card>
  );
}

function InviteDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (data: FormData) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-title"
    >
      <div
        className="w-full max-w-md overflow-y-auto rounded-[var(--radius-card)] bg-[var(--color-surface)] p-5"
        style={{ maxHeight: "calc(100vh - 2rem)" }}
      >
        <h2 id="invite-title" className="mb-3 text-lg font-semibold">
          Nova pozivnica
        </h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await onSubmit(new FormData(event.currentTarget));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Email osobe" htmlFor="invite-email" hint="Link važi 48 h i jednokratan je.">
            <input
              id="invite-email"
              name="email"
              type="email"
              required
              className={inputClass}
              style={{ minHeight: "var(--control-height)" }}
            />
          </Field>
          <Field label="Rola" htmlFor="invite-role">
            <select
              id="invite-role"
              name="role"
              className={inputClass}
              style={{ minHeight: "var(--control-height)" }}
              defaultValue="WORKER"
            >
              {Object.entries(ROLE_BS)
                .filter(([value]) => value !== "OWNER")
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Opseg" htmlFor="invite-scope">
            <select
              id="invite-scope"
              name="scope"
              className={inputClass}
              style={{ minHeight: "var(--control-height)" }}
              defaultValue="COMPANY"
            >
              {Object.entries(SCOPE_BS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="quiet" onClick={onClose} disabled={busy}>
              Otkaži
            </Button>
            <Button type="submit" variant="primary" fullWidthOnMobile disabled={busy}>
              {busy ? "Pravim…" : "Napravi link"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Dijalog „Role i opseg“.
 *
 * Zašto u dijalogu, a ne u redu tabele: mijenja se najviše pet rola i opseg — to je formular,
 * ne jedna akcija. Red zadržava jednu kontekstualnu akciju, kako je vlasnik tražio.
 *
 * Greška servisa se prikazuje U dijalogu, ne iza njega: ako je izmjena odbijena (npr. vlasnik,
 * posljednji vlasnik), korisnik treba da vidi razlog dok mu je forma još na ekranu.
 */
function MembershipDialog({
  user,
  actorIsOwner,
  busy,
  onSave,
  onClose,
}: {
  user: User;
  actorIsOwner: boolean;
  busy: boolean;
  onSave: (roles: string[], scope: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState<string[]>(user.roles);
  const [scope, setScope] = useState(user.scope);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  // Fokus ulazi u dijalog; `Escape` zatvara; fokus se vraća na dugme koje ga je otvorilo.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    firstField.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [onClose]);

  const options = Object.entries(ROLE_BS).filter(([value]) => value !== "OWNER" || actorIsOwner);
  const changed = roles.slice().sort().join(",") !== user.roles.slice().sort().join(",") || scope !== user.scope;

  function toggle(role: string) {
    setRoles((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
    );
  }

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="membership-title"
        className="w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] bg-[var(--color-surface)] p-5"
        // Dijalog je viši od ekrana na 360 px: skroluje SEBE, ne izlazi iz ekrana i ne
        // ostavlja stranicu da probije ispod njega.
        style={{ maxHeight: "calc(100vh - 2rem)" }}
      >
        <h2 id="membership-title" className="text-lg font-semibold">
          Role i opseg
        </h2>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
          {user.firstName} {user.lastName} · {user.email}
        </p>

        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-semibold">Role</legend>
          <div className="grid gap-1.5">
            {options.map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  ref={value === options[0]?.[0] ? firstField : undefined}
                  type="checkbox"
                  className="h-4 w-4"
                  checked={roles.includes(value)}
                  onChange={() => toggle(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-semibold">Opseg</legend>
          <div className="grid gap-1.5">
            {Object.entries(SCOPE_BS).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="membership-scope"
                  className="h-4 w-4"
                  checked={scope === value}
                  onChange={() => setScope(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {error ? (
          <div className="mt-3">
            <Alert tone="error" role="alert">
              {error}
            </Alert>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="quiet" onClick={onClose} disabled={busy || saving}>
            Otkaži
          </Button>
          <Button
            variant="primary"
            fullWidthOnMobile
            disabled={busy || saving || roles.length === 0 || !changed}
            onClick={async () => {
              setSaving(true);
              setError(null);
              const message = await onSave(roles, scope);
              setError(message);
              setSaving(false);
            }}
          >
            {saving ? "Čuvam…" : "Sačuvaj"}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
import { Alert, Button, Card, Chip, EmptyState, Field, Icon, Segmented, Skeleton, inputClass } from "@/components/ui";

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
  // Uz osobu pamtimo i dugme koje je otvorilo dijalog: meni se zatvara prije dijaloga, pa
  // `document.activeElement` u trenutku montiranja pokazuje na stavku koja upravo nestaje.
  const [editing, setEditing] = useState<{ user: User; returnTo: HTMLElement | null } | null>(null);

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
        scope: String(formData.get("scope") ?? ""),
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
    <div>
      <div className="gx-page-head">
        <div className="gx-page-head__text">
          <h1 className="gx-page-title">Korisnici</h1>
          <p className="gx-page-sub">Ljudi u firmi, njihove role i opseg pristupa.</p>
        </div>
        {canManage ? (
          <div className="gx-page-head__actions">
            <Button variant="primary" icon="users" onClick={() => setInviteOpen(true)}>
              Pozovi osobu
            </Button>
          </div>
        ) : null}
      </div>

      {message ? (
        <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </Alert>
      ) : null}
      {issued ? <IssuedLinkCard issued={issued} onClose={() => setIssued(null)} /> : null}

      <Card>
        <div className="gx-filters" style={{ marginBottom: "var(--space-5)" }}>
          <Field label="Traži osobu" htmlFor="user-filter">
            <input
              id="user-filter"
              className={inputClass}
              placeholder="Ime ili email"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </Field>
          <Field label="Rola" htmlFor="user-role">
            <select
              id="user-role"
              className={inputClass}
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
          </Field>
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
          <table className="gx-table gx-table--cards">
            <thead>
              <tr>
                <th>Osoba</th>
                <th>Rola</th>
                <th>Opseg</th>
                <th>Status</th>
                <th>Dodan</th>
                <th style={{ textAlign: "right" }}>Akcija</th>
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
                  onEdit={(returnTo) => setEditing({ user, returnTo })}
                />
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>

      {inviteOpen ? <InviteDialog onSubmit={issueInvite} onClose={() => setInviteOpen(false)} /> : null}
      {editing ? (
        <MembershipDialog
          user={editing.user}
          returnFocusTo={editing.returnTo}
          actorIsOwner={actorIsOwner}
          busy={busyId === editing.user.id}
          onSave={(roles, scope) => changeMembership(editing.user, roles, scope)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Status po referenci: puna tačka = aktivan, žuta = čeka prvu prijavu, prazna = deaktiviran.
 * Stanje nosi i tekst, ne samo tačka — boja je treći signal, nikad jedini.
 */
function statusOf(user: User) {
  if (!user.isActive) return { tone: "hollow" as const, label: "Deaktiviran" };
  if (user.mustChangePassword) return { tone: "hot" as const, label: "Čeka prvu prijavu" };
  return { tone: "full" as const, label: "Aktivan" };
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
  onEdit: (returnFocusTo: HTMLElement | null) => void;
}) {
  const status = statusOf(user);
  /**
   * Server bi ovo odbio (`USERS_TARGET_PROTECTED`), ali dugme koje ne može proći ne treba
   * ni da postoji: vlasnika mijenja samo vlasnik, a sebe niko ne deaktivira.
   */
  const protectedRow = (user.roles.includes("OWNER") && !actorIsOwner) || user.id === actorId;
  const actionable = canManage && !protectedRow;
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
    <tr>
      <td data-label="Osoba">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span aria-hidden="true" className="gx-avatar">
            {initials(user)}
          </span>
          <span className="gx-who" style={{ fontWeight: 600 }}>
            {user.firstName} {user.lastName}
            <span>{user.email}</span>
          </span>
        </div>
      </td>
      <td data-label="Rola">{rolesBs(user.roles)}</td>
      <td data-label="Opseg" style={{ color: "var(--muted)" }}>
        {SCOPE_BS[user.scope] ?? user.scope}
      </td>
      <td data-label="Status">
        <Chip tone={status.tone}>{status.label}</Chip>
      </td>
      <td data-label="Dodan" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
        <span className="gx-mono">{dateBs(user.createdAt)}</span>
      </td>
      <td data-label="Akcija">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          {canManage && protectedRow ? (
            <span style={{ whiteSpace: "nowrap", fontSize: "var(--text-small)", color: "var(--muted)" }}>
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
                ref={moreButton}
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Više radnji za ${user.firstName} ${user.lastName}`}
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
                    Role i opseg
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    className="gx-menu-item"
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
                    className="gx-menu-item"
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
                    className="gx-menu-item"
                    style={{ color: "var(--danger)" }}
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
      <p style={{ fontWeight: 700, marginBottom: "var(--space-2)" }}>Link za {issued.email}</p>
      <Alert tone="success">Kopirajte link i pošaljite ga sami. Važi do {expires}, jednokratan je.</Alert>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        <input
          className={inputClass}
          readOnly
          value={issued.link}
          aria-label="Link za kopiranje"
        />
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
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
      <p style={{ marginTop: "var(--space-2)", fontSize: "var(--text-small)", color: "var(--muted)" }}>
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
  const [scope, setScope] = useState<"COMPANY" | "SELF" | "">("");
  return (
    <div className="gx-overlay" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="invite-title" className="gx-dialog">
        <h2 id="invite-title" className="gx-dialog__title">
          Pozovi osobu
        </h2>
        <p className="gx-dialog__hint">Dobiće jednokratni link za postavljanje lozinke.</p>
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
          <div style={{ marginTop: "var(--space-5)" }}>
            <Field label="Email" htmlFor="invite-email" hint="Link važi 48 h i jednokratan je.">
              <input id="invite-email" name="email" type="email" required className={inputClass} />
            </Field>
          </div>
          <Field label="Rola" htmlFor="invite-role">
            <select id="invite-role" name="role" className={inputClass} defaultValue="WORKER">
              {Object.entries(ROLE_BS)
                .filter(([value]) => value !== "OWNER")
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </Field>
          {/* Opseg je izbor od dva stanja — segmentirana pilula, ne padajuća lista.
              Skriveno polje nosi vrijednost u formu, pa `FormData` ostaje isti. */}
          <div className="gx-field">
            <span className="gx-field__label" id="invite-scope-label">
              Opseg pristupa
            </span>
            <input type="hidden" name="scope" value={scope} />
            <p className="gx-field__hint">Izaberite opseg; pozivnica se ne može poslati bez ovog izbora.</p>
            <div role="group" aria-labelledby="invite-scope-label">
              <Segmented
                label="Opseg pristupa"
                value={scope}
                options={[
                  { value: "COMPANY", label: "Cijela firma" },
                  { value: "SELF", label: "Samo svoje" },
                ]}
                onChange={setScope}
              />
            </div>
          </div>
          <div className="gx-dialog__actions">
            <Button variant="quiet" onClick={onClose} disabled={busy}>
              Otkaži
            </Button>
            <Button type="submit" variant="primary" fullWidthOnMobile disabled={busy || scope === ""}>
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
  returnFocusTo,
  onSave,
  onClose,
}: {
  user: User;
  actorIsOwner: boolean;
  busy: boolean;
  returnFocusTo: HTMLElement | null;
  onSave: (roles: string[], scope: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState<string[]>(user.roles);
  const [scope, setScope] = useState(user.scope);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  // Fokus ulazi u dijalog; `Escape` zatvara; fokus se vraća na „⋯“ koji ga je otvorio
  // (`returnFocusTo`, ne `document.activeElement` — stavka menija u međuvremenu nestane).
  useEffect(() => {
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
      returnFocusTo?.focus?.();
    };
  }, [onClose, returnFocusTo]);

  const options = Object.entries(ROLE_BS).filter(([value]) => value !== "OWNER" || actorIsOwner);
  const changed = roles.slice().sort().join(",") !== user.roles.slice().sort().join(",") || scope !== user.scope;

  function toggle(role: string) {
    setRoles((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
    );
  }

  return (
    <div className="gx-overlay" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="membership-title" className="gx-dialog">
        <h2 id="membership-title" className="gx-dialog__title">
          Role i opseg
        </h2>
        <p className="gx-dialog__hint">
          {user.firstName} {user.lastName} · {user.email}
        </p>

        <fieldset style={{ marginTop: "var(--space-5)", border: 0, padding: 0 }}>
          <legend className="gx-field__label" style={{ marginBottom: "var(--space-2)" }}>
            Role
          </legend>
          <div style={{ display: "grid", gap: 6 }}>
            {options.map(([value, label]) => (
              <label key={value} className="gx-check">
                <input
                  ref={value === options[0]?.[0] ? firstField : undefined}
                  type="checkbox"
                  checked={roles.includes(value)}
                  onChange={() => toggle(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset style={{ marginTop: "var(--space-5)", border: 0, padding: 0 }}>
          <legend className="gx-field__label" style={{ marginBottom: "var(--space-2)" }}>
            Opseg
          </legend>
          <Segmented
            label="Opseg"
            value={scope}
            options={[
              { value: "COMPANY", label: "Cijela firma" },
              { value: "SELF", label: "Samo svoje" },
            ]}
            onChange={setScope}
          />
        </fieldset>

        {error ? (
          <div style={{ marginTop: "var(--space-4)" }}>
            <Alert tone="error" role="alert">
              {error}
            </Alert>
          </div>
        ) : null}

        <div className="gx-dialog__actions">
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

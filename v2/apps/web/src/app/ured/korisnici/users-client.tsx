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
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import {
  Alert, Avatar, Button, Card, Chip, DataTable, EmptyState, FilterBar, Input, Mono,
  PageHeader, Select, Skeleton, Stack,
} from "@/components/ui/index";
import { InviteDialog, IssuedLinkCard, MembershipDialog } from "./users-dialogs";

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

export type IssuedLink = { link: string; email: string; expiresAt: string } | null;

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

/**
 * Datum na bosanskom, bez `Intl`-a: `bs-BA` u Chromiumu daje „2026 M11 7“.
 * Format je `7. 11. 2026.` — isto na svakom pregledniku.
 */
const dateBs = (value: string) => {
  const date = new Date(value);
  return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}.`;
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
    const result = await apiCall<{ users: User[] }>("/api/users");
    if (!result.ok) {
      setState({ kind: "error", message: result.message });
      return;
    }
    setState({ kind: "ready", users: result.data.users });
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
    const result = await apiCall<{ link: string; email: string; expiresAt: string }>("/api/users/invitations", jsonBody({
      email: String(formData.get("email") ?? ""),
      roles: [String(formData.get("role") ?? "WORKER")],
      scope: String(formData.get("scope") ?? ""),
    }));
    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return;
    }
    setInviteOpen(false);
    setIssued({ link: result.data.link, email: result.data.email, expiresAt: result.data.expiresAt });
    setMessage({ tone: "success", text: "Pozivnica je napravljena. Kopirajte link i pošaljite ga sami." });
    await load();
  }

  async function issueReset(user: User) {
    setBusyId(user.id);
    try {
      const result = await apiCall<{ link: string; expiresAt: string }>(`/api/users/${user.id}/reset-password`, { method: "POST" });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
        return;
      }
      setIssued({ link: result.data.link, email: user.email, expiresAt: result.data.expiresAt });
      setMessage({ tone: "success", text: `Link za ${user.email} je napravljen.` });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(user: User) {
    setBusyId(user.id);
    try {
      const result = await apiCall(`/api/users/${user.id}/active`, patchBody({ active: !user.isActive }));
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
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
      const result = await apiCall(`/api/users/${user.id}/membership`, patchBody({ roles, scope }));
      if (!result.ok) {
        // Greška ostaje u dijalogu: korisnik treba da vidi šta servis odbija i zašto.
        return result.message;
      }
      setEditing(null);
      setMessage({
        tone: "success",
        text: `Role i opseg za ${user.firstName} su promijenjeni. Trag je zapisan.`,
      });
      await load();
      return null;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Korisnici"
        subtitle="Ljudi u firmi, njihove role i opseg pristupa."
        actions={canManage ? (
          <Button variant="primary" icon="users" onClick={() => setInviteOpen(true)}>
            Pozovi osobu
          </Button>
        ) : null}
      />

      {message ? (
        <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </Alert>
      ) : null}
      {issued ? <IssuedLinkCard issued={issued} onClose={() => setIssued(null)} /> : null}

      <Card>
        <FilterBar>
          <Input label="Traži osobu"id="user-filter"
              placeholder="Ime ili email"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          <Select label="Rola"id="user-role"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="">Sve role</option>
              {Object.entries(ROLE_BS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
        </FilterBar>

        {state.kind === "loading" ? <Skeleton rows={4} /> : null}

        {state.kind === "error" ? (
          <Stack>
            <Alert tone="error" role="alert">
              {state.message}
            </Alert>
            <div>
              <Button onClick={() => void load()}>Pokušaj ponovo</Button>
            </div>
          </Stack>
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
          <DataTable
            caption="Korisnici firme"
            rows={visible}
            rowKey={(user) => user.id}
            emptyText="Nema osoba koje odgovaraju filteru."
            columns={[
              {
                key: "person",
                header: "Osoba",
                cell: (user) => (
                  <span className="gx-inline-flex">
                    <Avatar name={`${user.firstName} ${user.lastName}`} size="sm" />
                    <span className="gx-who">
                      {user.firstName} {user.lastName}
                      <span>{user.email}</span>
                      {canManage && ((user.roles.includes("OWNER") && !actorIsOwner) || user.id === actorId) ? (
                        <span>{user.id === actorId ? "vi" : "samo vlasnik"}</span>
                      ) : null}
                    </span>
                  </span>
                ),
              },
              { key: "roles", header: "Rola", cell: (user) => rolesBs(user.roles) },
              { key: "scope", header: "Opseg", cell: (user) => SCOPE_BS[user.scope] ?? user.scope },
              { key: "status", header: "Status", cell: (user) => <Chip tone={statusOf(user).tone}>{statusOf(user).label}</Chip> },
              { key: "added", header: "Dodan", cell: (user) => <Mono>{dateBs(user.createdAt)}</Mono> },
            ]}
            rowActionLabel={(user) => `Više radnji za ${user.firstName} ${user.lastName}`}
            actions={(user) => {
              const protectedRow = (user.roles.includes("OWNER") && !actorIsOwner) || user.id === actorId;
              if (!canManage || protectedRow) return [];
              const primary = !user.isActive
                ? { key: "toggle", label: "Aktiviraj", onSelect: () => void toggleActive(user) }
                : user.mustChangePassword
                  ? { key: "reset", label: "Pošalji pozivnicu", onSelect: () => void issueReset(user) }
                  : { key: "reset", label: "Reset lozinke", onSelect: () => void issueReset(user) };
              return [
                primary,
                { key: "edit", label: "Role i opseg", onSelect: (returnTo) => setEditing({ user, returnTo: returnTo ?? null }) },
                { key: "copy", label: "Kopiraj email", onSelect: () => void navigator.clipboard?.writeText(user.email) },
                { key: "link", label: "Novi link za lozinku", onSelect: () => void issueReset(user) },
                { key: "toggle2", label: user.isActive ? "Deaktiviraj osobu" : "Aktiviraj osobu", danger: true, onSelect: () => void toggleActive(user) },
              ];
            }}
          />
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

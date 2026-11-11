"use client";

/** Dijalozi korisnika: pozivnica, izdani link, role i opseg — Dialog obrazac iz kataloga. */
import { useState } from "react";
import {
  Alert, Button, Card, Checkbox, Dialog, Input, Segmented, Select, Stack,
} from "@/components/ui/index";
import type { IssuedLink, User } from "./users-client";

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

const dateBs = (value: string) => {
  const date = new Date(value);
  return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}.`;
};

const dateTimeBs = (value: string) =>
  `${dateBs(value)} u ${String(new Date(value).getHours()).padStart(2, "0")}:${String(new Date(value).getMinutes()).padStart(2, "0")}`;

export function IssuedLinkCard({ issued, onClose }: { issued: NonNullable<IssuedLink>; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const expires = dateTimeBs(issued.expiresAt);
  return (
    <Card>
      <p><strong>Link za {issued.email}</strong></p>
      <Alert tone="success">Kopirajte link i pošaljite ga sami. Važi do {expires}, jednokratan je.</Alert>
      <div className="gx-stack gx-stack--2 gx-mt-3">
        <Input
          readOnly
          value={issued.link}
          aria-label="Link za kopiranje"
         />
        <div className="gx-inline-flex">
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
      <p className="gx-page-sub gx-mt-2">
        Ako zatvorite bez kopiranja, link se više ne može prikazati — napravite novi.
      </p>
    </Card>
  );
}

export function InviteDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (data: FormData) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"COMPANY" | "SELF" | "">("");
  return (
    <Dialog
      title="Pozovi osobu"
      hint="Dobiće jednokratni link za postavljanje lozinke."
      onClose={onClose}
      footer={(
        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={busy}>
            Otkaži
          </Button>
          <Button type="submit" form="invite-form" variant="primary" fullWidthOnMobile disabled={busy || scope === ""}>
            {busy ? "Pravim…" : "Napravi link"}
          </Button>
        </div>
      )}
    >
      <form
        id="invite-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            const data = new FormData(event.currentTarget);
            data.set("scope", scope);
            await onSubmit(data);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Stack>
          <Input label="Email" hint="Link važi 48 h i jednokratan je." id="invite-email" name="email" type="email" required />
          <Select label="Rola" id="invite-role" name="role" defaultValue="WORKER">
            {Object.entries(ROLE_BS)
              .filter(([value]) => value !== "OWNER")
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </Select>
          {/* Opseg je izbor od dva stanja — segmentirana pilula, ne padajuća lista.
              Vrijednost se dodaje u FormData pri slanju (scope je stanje, ne polje). */}
          <Segmented
            label="Opseg pristupa"
            value={scope}
            options={[
              { value: "COMPANY", label: "Cijela firma" },
              { value: "SELF", label: "Samo svoje" },
            ]}
            onChange={setScope}
          />
        </Stack>
      </form>
    </Dialog>
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
export function MembershipDialog({
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

  const options = Object.entries(ROLE_BS).filter(([value]) => value !== "OWNER" || actorIsOwner);
  const changed = roles.slice().sort().join(",") !== user.roles.slice().sort().join(",") || scope !== user.scope;

  function toggle(role: string) {
    setRoles((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
    );
  }

  return (
    <Dialog
      title="Role i opseg"
      hint={`${user.firstName} ${user.lastName} · ${user.email}`}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
      footer={(
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
      )}
    >
      <Stack>
        <fieldset>
          <legend className="gx-field__label">Role</legend>
          <Stack>
            {options.map(([value, label]) => (
              <Checkbox
                key={value}
                label={label}
                id={`role-${value}`}
                checked={roles.includes(value)}
                onChange={() => toggle(value)}
              />
            ))}
          </Stack>
        </fieldset>

        <fieldset>
          <legend className="gx-field__label">Opseg</legend>
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
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        ) : null}
      </Stack>
    </Dialog>
  );
}

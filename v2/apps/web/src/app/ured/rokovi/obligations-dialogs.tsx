"use client";

/** Dijalozi rokova: re-export create + renew. */
import { useState } from "react";
import type { Obligation } from "@gradix/contracts";
import { apiCall, jsonBody } from "@/api-client";
import { formatDate } from "@/format";
import { Alert, Button, Dialog, Input } from "@/components/ui/index";
import { targetLabel } from "./obligations-shared";

export { CreateDialog } from "./obligations-create-dialog";

/** Obnova: nova verzija. Stara ostaje — to i piše u dijalogu. */
export function RenewDialog({
  obligation,
  returnFocusTo,
  onSaved,
  onClose,
}: {
  obligation: Obligation;
  returnFocusTo: HTMLElement | null;
  onSaved: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [number, setNumber] = useState("");
  const [issuer, setIssuer] = useState(obligation.issuer ?? "");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await apiCall<{ obligation: Obligation }>(
        `/api/obligations/${obligation.id}/renew`,
        jsonBody({
          number: number.trim() || null,
          issuer: issuer.trim() || null,
          issuedAt: issuedAt || null,
          expiresAt,
        }),
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onSaved(
        `${obligation.typeLabel} je obnovljena — verzija ${result.data.obligation.currentVersion}. Stara ostaje u historiji.`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={`Obnova · ${obligation.typeLabel}`}
      hint={`${targetLabel(obligation)} · trenutni rok ${formatDate(obligation.expiresAt)} · verzija ${obligation.currentVersion}`}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
    >
      <form onSubmit={save} className="gx-stack">
        {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
        <Input
          label="Novi rok"
          hint="Mora biti poslije trenutnog roka."
          id="renew-expires"
          type="date"
          value={expiresAt}
          min={obligation.expiresAt ?? undefined}
          onChange={(event) => setExpiresAt(event.target.value)}
          required
        />
        <div className="gx-cols">
          <Input label="Novi broj dokumenta" id="renew-number" value={number}
            onChange={(event) => setNumber(event.target.value)} maxLength={120} />
          <Input label="Izdavalac" id="renew-issuer" value={issuer}
            onChange={(event) => setIssuer(event.target.value)} maxLength={200} />
        </div>
        <Input label="Datum izdavanja novog dokumenta" id="renew-issued" type="date"
          value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} />
        <p className="gx-page-sub">
          Stara verzija ostaje u historiji sa svojim rokom — ne prepisuje se.
        </p>
        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>Otkaži</Button>
          <Button type="submit" variant="primary" fullWidthOnMobile disabled={saving || !expiresAt}>
            {saving ? "Obnavljam…" : "Obnovi"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

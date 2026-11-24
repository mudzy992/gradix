"use client";

/**
 * Tab Sigurnost: 2FA TOTP uparivanje i recovery kodovi (spec 01 §2.4).
 *
 * Recovery kodovi se prikazuju TAČNO JEDNOM — poslije potvrde u bazi ostaje samo SHA-256.
 * Zato ekran traži da se prepišu prije zatvaranja, a ne „pošalji mi ih na email“.
 */
import { useCallback, useEffect, useState } from "react";
import { apiCall } from "@/api-client";
import { Alert, Button, Card, FormSection, Input, Skeleton, Stack } from "@/components/ui/index";

type TwoFactorStatus = {
  enabled: boolean;
  pendingEnrollment: boolean;
  recoveryCodesLeft: number;
  required: boolean;
};

export function SigurnostTab() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enrollment, setEnrollment] = useState<{ uri: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    const result = await apiCall<TwoFactorStatus>("/api/auth/2fa/status");
    if (result.ok) setStatus(result.data);
    else setError(result.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startEnrollment = async () => {
    setBusy(true);
    setError(null);
    const result = await apiCall<{ uri: string; secret: string }>("/api/auth/2fa/enroll", { method: "POST" });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEnrollment(result.data);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await apiCall<{ recoveryCodes: string[] }>("/api/auth/2fa/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRecoveryCodes(result.data.recoveryCodes);
    setEnrollment(null);
    setCode("");
    void load();
  };

  return (
    <Card>
      <FormSection title="Dvofaktorska prijava (2FA)">
        {error ? <Alert tone="error">
          <strong>Greška.</strong> {error}</Alert> : null}
        {!status ? (
          <Skeleton rows={2} />
        ) : status.enabled ? (
          <Stack>
            <Alert tone="success">
          <strong>2FA je uključena.</strong> 
              Prijava traži kod iz autentikator aplikacije. Preostalih recovery kodova: {status.recoveryCodesLeft}.
            </Alert>
            {status.required ? (
              <p className="gx-muted">Vaša rola zahtijeva 2FA — isključivanje nije moguće.</p>
            ) : (
              <p className="gx-muted">Isključivanje traži lozinku i tekući kod.</p>
            )}
          </Stack>
        ) : (
          <Stack>
            <Alert tone={status.required ? "warning" : "info"}>
              <strong>
                {status.required ? "2FA je obavezna za vašu rolu." : "2FA nije uključena."}
              </strong>
              {status.required
                ? " Dok ne uparite autentikator, nemate pristup ostalim ekranima."
                : " Preporučujemo uključivanje: štiti nalog i kad neko sazna lozinku."}
            </Alert>
            {!enrollment ? (
              <Button onClick={() => void startEnrollment()} disabled={busy}>
                Uključi 2FA
              </Button>
            ) : (
              <Stack>
                <p>Upišite ovaj ključ u autentikator (Google Authenticator, Aegis, 1Password):</p>
                <code className="gx-code">{enrollment.secret}</code>
                <Input
                  label="Kod iz aplikacije (6 cifara)"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                />
                <Button onClick={() => void confirm()} disabled={busy || code.length !== 6}>
                  Potvrdi i uključi
                </Button>
              </Stack>
            )}
            {recoveryCodes ? (
              <Alert tone="warning">
          <strong>Recovery kodovi — prepišite ih sada.</strong> 
                <ul className="gx-code-list">
                  {recoveryCodes.map((recoveryCode) => (
                    <li key={recoveryCode}>
                      <code>{recoveryCode}</code>
                    </li>
                  ))}
                </ul>
                Svaki kod vrijedi jednom. Poslije zatvaranja ovog ekrana ne mogu se ponovo prikazati.
              </Alert>
            ) : null}
          </Stack>
        )}
      </FormSection>
    </Card>
  );
}

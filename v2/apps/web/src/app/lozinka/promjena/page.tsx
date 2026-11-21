"use client";

/**
 * Promjena lozinke. Dvije situacije, isti ekran:
 *  1. obavezna promjena poslije prve prijave (`pwd=1` u sesiji) — bez „otkaži“,
 *  2. dobrovoljna promjena iz zaglavlja.
 *
 * Stanja: prazno (forma), greška (politika / pogrešna trenutna), uspjeh.
 */
import { useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { Alert, Button, Card, Input } from "@/components/ui/index";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string }
  | { kind: "success"; revoked: number };

export default function ChangePasswordPage() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const newPassword = String(formData.get("newPassword") ?? "");
    const repeat = String(formData.get("repeat") ?? "");

    if (newPassword !== repeat) {
      setState({ kind: "error", message: "Lozinke se ne poklapaju." });
      return;
    }

    setState({ kind: "busy" });
    const result = await apiCall<{ revokedSessions?: number }>("/api/auth/change-password", jsonBody({
      currentPassword: String(formData.get("currentPassword") ?? ""),
      newPassword,
    }));
    if (!result.ok) {
      setState({ kind: "error", message: result.message });
      return;
    }
    setState({ kind: "success", revoked: Number(result.data?.revokedSessions ?? 0) });
    setTimeout(() => {
      window.location.href = "/ured/korisnici";
    }, 1200);
  }

  return (
    <div className="gx-page gx-auth-narrow">
      <Card>
        <h1 className="gx-page-title">Postavite novu lozinku</h1>
        <p className="gx-page-sub">
          Dok ne postavite novu lozinku, ostatak sistema vam nije dostupan.
        </p>

        {state.kind === "error" ? (
          <Alert tone="error" role="alert">
            {state.message}
          </Alert>
        ) : null}
        {state.kind === "success" ? (
          <Alert tone="success">
            Lozinka je promijenjena.
            {state.revoked > 0 ? ` Odjavljeno je još ${state.revoked} sesija.` : ""}
          </Alert>
        ) : null}

        <form onSubmit={submit} noValidate>
          <Input label="Trenutna lozinka" id="currentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password" />
          <Input label="Nova lozinka" hint="Najmanje 10 znakova, slovo i broj. Ne smije biti ista kao trenutna." id="newPassword"
              name="newPassword"
              type="password"
              required
              autoComplete="new-password"
              aria-describedby="newPassword-hint" />
          <Input label="Nova lozinka još jednom" id="repeat"
              name="repeat"
              type="password"
              required
              autoComplete="new-password" />
          <Button type="submit" variant="primary" disabled={state.kind === "busy"} className="gx-btn--block">
            {state.kind === "busy" ? "Postavljam…" : "Postavi lozinku i nastavi"}
          </Button>
        </form>
        <p className="gx-page-sub">
          Poslije promjene sve ostale sesije se gase — ako je neko drugi bio prijavljen, ispada.
        </p>
      </Card>
    </div>
  );
}

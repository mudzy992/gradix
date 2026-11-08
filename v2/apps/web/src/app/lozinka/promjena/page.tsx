"use client";

/**
 * Promjena lozinke. Dvije situacije, isti ekran:
 *  1. obavezna promjena poslije prve prijave (`pwd=1` u sesiji) — bez „otkaži“,
 *  2. dobrovoljna promjena iz zaglavlja.
 *
 * Stanja: prazno (forma), greška (politika / pogrešna trenutna), uspjeh.
 */
import { useState } from "react";
import { Alert, Button, Card, Field, inputClass } from "@/components/ui";

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
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: String(formData.get("currentPassword") ?? ""),
          newPassword,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setState({ kind: "error", message: body?.error?.message ?? "Promjena nije prošla." });
        return;
      }
      setState({ kind: "success", revoked: Number(body.data.revokedSessions ?? 0) });
      setTimeout(() => {
        window.location.href = "/ured/korisnici";
      }, 1200);
    } catch {
      setState({ kind: "error", message: "Nema veze sa serverom. Provjerite mrežu." });
    }
  }

  return (
    <div className="gx-page" style={{ maxWidth: 520, padding: 0 }}>
      <Card>
        <h1 className="gx-page-title" style={{ fontSize: 24 }}>
          Postavite novu lozinku
        </h1>
        <p className="gx-page-sub" style={{ marginBottom: "var(--space-5)" }}>
          Dok ne postavite novu lozinku, ostatak sistema vam nije dostupan.
        </p>

        {state.kind === "error" ? (
          <div style={{ marginBottom: "var(--space-4)" }}>
            <Alert tone="error" role="alert">
              {state.message}
            </Alert>
          </div>
        ) : null}
        {state.kind === "success" ? (
          <div style={{ marginBottom: "var(--space-4)" }}>
            <Alert tone="success">
              Lozinka je promijenjena.
              {state.revoked > 0 ? ` Odjavljeno je još ${state.revoked} sesija.` : ""}
            </Alert>
          </div>
        ) : null}

        <form onSubmit={submit} noValidate>
          <Field label="Trenutna lozinka" htmlFor="currentPassword">
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </Field>
          <Field
            label="Nova lozinka"
            htmlFor="newPassword"
            hint="Najmanje 10 znakova, slovo i broj. Ne smije biti ista kao trenutna."
          >
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              required
              autoComplete="new-password"
              aria-describedby="newPassword-hint"
              className={inputClass}
            />
          </Field>
          <Field label="Nova lozinka još jednom" htmlFor="repeat">
            <input
              id="repeat"
              name="repeat"
              type="password"
              required
              autoComplete="new-password"
              className={inputClass}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={state.kind === "busy"} className="gx-btn--block">
            {state.kind === "busy" ? "Postavljam…" : "Postavi lozinku i nastavi"}
          </Button>
        </form>
        <p className="gx-page-sub" style={{ marginTop: "var(--space-4)", fontSize: "var(--text-small)" }}>
          Poslije promjene sve ostale sesije se gase — ako je neko drugi bio prijavljen, ispada.
        </p>
      </Card>
    </div>
  );
}

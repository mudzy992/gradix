"use client";

/**
 * Postavljanje lozinke preko jednokratnog linka (pozivnica ili reset).
 *
 * Token dolazi u query-ju. Nakon uspjeha URL se zamjenjuje (`history.replaceState`),
 * da token ne ostane u istoriji preglednika.
 *
 * Stanja: učitavanje, link nevažeći (istekao/iskorišten/izmišljen — isti tekst),
 * forma, uspjeh, greška politike.
 */
import { useEffect, useState } from "react";
import { Alert, Button, Card, Field, Skeleton, inputClass } from "@/components/ui";

type Preview = {
  email: string;
  roles: string[];
  scope: string;
  companyName: string;
  expiresAt: string;
  kind: "invite" | "reset";
};

type State =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "form"; preview: Preview }
  | { kind: "busy"; preview: Preview }
  | { kind: "error"; preview: Preview; message: string }
  | { kind: "done"; email: string };

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

export default function SetPasswordPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [token, setToken] = useState<string>("");

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(value);
    if (!value) {
      setState({ kind: "invalid", message: "Link nije ispravan. Zamolite administratora da izda novi." });
      return;
    }
    // Pozivnica i reset imaju različite prefikse, pa se ruta zna bez pitanja baze.
    const kind = value.startsWith("gxr_") ? "reset" : "invite";
    if (kind === "reset") {
      // Reset ne otkriva email ni firmu prije nego što je lozinka postavljena.
      setState({
        kind: "form",
        preview: { email: "", roles: [], scope: "", companyName: "", expiresAt: "", kind },
      });
      return;
    }
    void (async () => {
      try {
        const response = await fetch(`/api/invitations/${value}`);
        const body = await response.json();
        if (!response.ok || !body.success) {
          setState({
            kind: "invalid",
            message: "Link je istekao ili je već iskorišten. Zamolite administratora da izda novi.",
          });
          return;
        }
        setState({ kind: "form", preview: { ...body.data, kind } });
      } catch {
        setState({ kind: "invalid", message: "Nema veze sa serverom. Pokušajte ponovo." });
      }
    })();
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind !== "form") return;
    const preview = state.preview;
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const repeat = String(formData.get("repeat") ?? "");
    if (password !== repeat) {
      setState({ kind: "error", preview, message: "Lozinke se ne poklapaju." });
      return;
    }

    setState({ kind: "busy", preview });
    try {
      const endpoint =
        preview.kind === "reset" ? `/api/password-resets/${token}` : `/api/invitations/${token}`;
      const payload =
        preview.kind === "reset"
          ? { password }
          : {
              password,
              firstName: String(formData.get("firstName") ?? ""),
              lastName: String(formData.get("lastName") ?? ""),
            };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setState({ kind: "error", preview, message: body?.error?.message ?? "Lozinka nije postavljena." });
        return;
      }
      // Token iz URL-a i iz istorije: zamjena adrese bez novog unosa u istoriju.
      window.history.replaceState(null, "", "/lozinka/postavi");
      setState({ kind: "done", email: preview.email });
    } catch {
      setState({ kind: "error", preview, message: "Nema veze sa serverom. Pokušajte ponovo." });
    }
  }

  return (
    <div className="gx-page" style={{ maxWidth: 520, padding: 0 }}>
      <Card>
        {state.kind === "loading" ? (
          <>
            <h1 className="gx-page-title" style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>Provjeravam link…</h1>
            <Skeleton rows={3} />
          </>
        ) : null}

        {state.kind === "invalid" ? (
          <>
            <h1 className="gx-page-title" style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>Link ne važi</h1>
            <Alert tone="warning" role="alert">
              {state.message}
            </Alert>
            <p className="gx-page-sub" style={{ marginTop: "var(--space-4)", fontSize: "var(--text-small)" }}>
              Iz bezbjednosnih razloga ne pravimo razliku između isteklog, iskorištenog i izmišljenog linka.
            </p>
          </>
        ) : null}

        {state.kind === "done" ? (
          <>
            <h1 className="gx-page-title" style={{ fontSize: 24, marginBottom: "var(--space-4)" }}>Lozinka je postavljena</h1>
            <Alert tone="success">
              {state.email ? `Nalog ${state.email} je spreman.` : "Nalog je spreman."} Možete se prijaviti.
            </Alert>
            <div style={{ marginTop: "var(--space-4)" }}>
              <Button variant="primary" onClick={() => (window.location.href = "/login")}>
                Na prijavu
              </Button>
            </div>
          </>
        ) : null}

        {state.kind === "form" || state.kind === "busy" || state.kind === "error" ? (
          <>
            <h1 className="gx-page-title" style={{ fontSize: 24 }}>
              {state.preview.kind === "reset" ? "Postavite novu lozinku" : "Dobro došli u Gradix"}
            </h1>
            <p className="gx-page-sub" style={{ marginBottom: "var(--space-4)" }}>
              {state.preview.kind === "reset"
                ? "Postavite lozinku. Sve stare sesije se gase."
                : `${state.preview.companyName} · ${state.preview.email}`}
            </p>
            {state.preview.roles.length > 0 ? (
              <p style={{ marginBottom: "var(--space-4)" }}>
                Rola: <strong>{state.preview.roles.map((role) => ROLE_BS[role] ?? role).join(", ")}</strong>
              </p>
            ) : null}

            {state.kind === "error" ? (
              <div style={{ marginBottom: "var(--space-4)" }}>
                <Alert tone="error" role="alert">
                  {state.message}
                </Alert>
              </div>
            ) : null}

            <form onSubmit={submit} noValidate>
              {state.preview.kind === "invite" ? (
                <>
                  <Field label="Ime" htmlFor="firstName">
                    <input
                      id="firstName"
                      name="firstName"
                      required
                      autoComplete="given-name"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Prezime" htmlFor="lastName">
                    <input
                      id="lastName"
                      name="lastName"
                      required
                      autoComplete="family-name"
                      className={inputClass}
                    />
                  </Field>
                </>
              ) : null}
              <Field
                label="Lozinka"
                htmlFor="password"
                hint="Najmanje 10 znakova, slovo i broj."
              >
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  aria-describedby="password-hint"
                  className={inputClass}
                />
              </Field>
              <Field label="Lozinka još jednom" htmlFor="repeat">
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
                {state.kind === "busy" ? "Postavljam…" : "Postavi lozinku"}
              </Button>
            </form>
            <p className="gx-page-sub" style={{ marginTop: "var(--space-4)", fontSize: "var(--text-small)" }}>
              Link je jednokratan i važi 48 h od izdavanja.
            </p>
          </>
        ) : null}
      </Card>
    </div>
  );
}

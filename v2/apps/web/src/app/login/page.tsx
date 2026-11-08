"use client";

/**
 * Prijava. Ekran stoji na pozadini (bez okvira — nema šta da se navigira prije prijave) i
 * ima JEDNU jasnu akciju, kako DESIGN.md traži.
 *
 * Stanja: prazno, slanje, greška (uključujući brojanje sekundi do novog pokušaja).
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string; retryAfter?: number };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Odbrojavanje traje samo dok traje zabrana; `retryAfter` u stanju je početna vrijednost.
  const retryAfter = state.kind === "error" ? state.retryAfter : undefined;
  useEffect(() => {
    if (!retryAfter) return;
    setSecondsLeft(retryAfter);
    const timer = setInterval(() => {
      setSecondsLeft((left) => (left <= 1 ? 0 : left - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfter]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState({ kind: "busy" });
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as
        | { success: true }
        | { success: false; error: { code: string; message: string } };
      if (!response.ok || !body.success) {
        // Kad je limit aktivan, poruka nosi stvarni broj sekundi; ekran ga odbrojava sam,
        // da korisnik ne mora da pogađa kad smije ponovo (i da ne troši pokušaje).
        const retryAfter = Number(response.headers.get("retry-after"));
        setState({
          kind: "error",
          message: body.success ? "Prijava nije uspjela." : body.error.message,
          ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
        });
        return;
      }
      // Obavezna promjena lozinke ide prije bilo čega drugog.
      const mustChange = (body as { data?: { mustChangePassword?: boolean } }).data?.mustChangePassword;
      router.replace(mustChange ? "/lozinka/promjena" : "/pregled");
      router.refresh();
    } catch {
      setState({ kind: "error", message: "Nema veze sa serverom. Provjerite mrežu." });
    }
  }

  return (
    <main className="gx-auth">
      <div className="gx-auth__card">
        <div className="gx-brand" style={{ padding: "0 0 var(--space-5)" }}>
          <span aria-hidden="true" className="gx-brand__mark" />
          <span>Gradix</span>
        </div>

        <h1 className="gx-page-title" style={{ fontSize: 24 }}>
          Prijava
        </h1>
        <p className="gx-page-sub">Operativni sistem za niskogradnju.</p>

        <form style={{ marginTop: "var(--space-6)" }} onSubmit={submit} noValidate>
          <Field label="Email" htmlFor="email">
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Lozinka" htmlFor="password">
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </Field>

          {state.kind === "error" ? (
            <div style={{ marginBottom: "var(--space-4)" }}>
              <Alert tone="error" role="alert">
                {secondsLeft > 0
                  ? `Previše pokušaja. Pokušajte ponovo za ${secondsLeft} s.`
                  : state.message}
              </Alert>
            </div>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            fullWidthOnMobile
            disabled={state.kind === "busy" || secondsLeft > 0}
            className="gx-btn--block"
          >
            {state.kind === "busy" ? "Prijava…" : "Prijavi se"}
          </Button>
        </form>

        <p className="gx-page-sub" style={{ marginTop: "var(--space-4)", fontSize: "var(--text-small)" }}>
          Zaboravljena lozinka? Obratite se administratoru firme — on izdaje jednokratni link.
        </p>
      </div>
    </main>
  );
}

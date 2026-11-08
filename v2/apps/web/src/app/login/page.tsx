"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
    <main className="flex min-h-[calc(100vh-2rem)] items-center justify-center p-4">
      <div className="gx-panel w-full max-w-sm" style={{ padding: "var(--card-pad)" }}>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Gradix</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Prijava u sistem</p>

        <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="gx-input mt-1"
              style={{ minHeight: "var(--control-height)", borderRadius: "var(--radius)" }}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              Lozinka
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="gx-input mt-1"
              style={{ minHeight: "var(--control-height)", borderRadius: "var(--radius)" }}
            />
          </div>

          {state.kind === "error" && (
            <p role="alert" className="rounded-md bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {secondsLeft > 0
                ? `Previše pokušaja. Pokušajte ponovo za ${secondsLeft} s.`
                : state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={state.kind === "busy" || secondsLeft > 0}
            className="gx-primary-full gx-btn border border-[var(--color-brand)] bg-[var(--color-brand)] px-4 font-semibold text-[var(--color-text-inverse)] hover:bg-[var(--color-brand-hover)] disabled:opacity-60"
            style={{ minHeight: "var(--control-height)", borderRadius: "var(--radius)" }}
          >
            {state.kind === "busy" ? "Prijava…" : "Prijavi se"}
          </button>
        </form>
        <p className="mt-4 text-[13px] text-[var(--color-text-muted)]">
          Zaboravljena lozinka? Obratite se administratoru firme — on izdaje jednokratni link.
        </p>
      </div>
    </main>
  );
}

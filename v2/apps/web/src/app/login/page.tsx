"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

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
        setState({
          kind: "error",
          message: body.success ? "Prijava nije uspjela." : body.error.message,
        });
        return;
      }
      router.replace("/pregled");
      router.refresh();
    } catch {
      setState({ kind: "error", message: "Nema veze sa serverom. Provjerite mrežu." });
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
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
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-base"
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
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-base"
            />
          </div>

          {state.kind === "error" && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={state.kind === "busy"}
            className="w-full rounded-md bg-[var(--color-brand)] px-4 py-2.5 text-base font-medium text-white disabled:opacity-60"
          >
            {state.kind === "busy" ? "Prijava…" : "Prijavi se"}
          </button>
        </form>
      </div>
    </main>
  );
}

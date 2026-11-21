"use client";

/**
 * Prijava. Ekran stoji na pozadini (bez okvira — nema šta da se navigira prije prijave) i
 * ima JEDNU jasnu akciju, kako DESIGN.md traži.
 *
 * Stanja: prazno, slanje, greška (uključujući brojanje sekundi do novog pokušaja).
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { Alert, Button, Input, Stack } from "@/components/ui/index";

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
    const result = await apiCall<{ mustChangePassword?: boolean }>("/api/auth/login", jsonBody({ email, password }));
    if (!result.ok) {
      // Kad je limit aktivan, poruka nosi stvarni broj sekundi (retry-after); ekran ga
      // odbrojava sam, da korisnik ne troši pokušaje pogađajući kad smije ponovo.
      setState({ kind: "error", message: result.message, ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}) });
      return;
    }
    // Obavezna promjena lozinke ide prije bilo čega drugog.
    router.replace(result.data?.mustChangePassword ? "/lozinka/promjena" : "/pregled");
    router.refresh();
  }

  return (
    <main className="gx-auth">
      <div className="gx-auth__card">
        <div className="gx-brand">
          <span aria-hidden="true" className="gx-brand__mark" />
          <span>Gradix</span>
        </div>

        <h1 className="gx-page-title">Prijava</h1>
        <p className="gx-page-sub">Operativni sistem za niskogradnju.</p>

        <form onSubmit={submit} noValidate>
          <Stack>
            <Input label="Email" id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <Input label="Lozinka" id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />

            {state.kind === "error" ? (
              <Alert tone="error" role="alert">
                {secondsLeft > 0
                  ? `Previše pokušaja. Pokušajte ponovo za ${secondsLeft} s.`
                  : state.message}
              </Alert>
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
          </Stack>
        </form>

        <p className="gx-page-sub">
          Zaboravljena lozinka? Obratite se administratoru firme — on izdaje jednokratni link.
        </p>
      </div>
    </main>
  );
}

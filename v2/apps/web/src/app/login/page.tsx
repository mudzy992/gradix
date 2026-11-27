"use client";

/**
 * Prijava. Ekran stoji na pozadini (bez okvira — nema šta da se navigira prije prijave) i
 * ima JEDNU jasnu akciju, kako DESIGN.md traži.
 *
 * Stanja: prazno, slanje, greška (uključujući brojanje sekundi do novog pokušaja),
 * i DRUGI KORAK — kod iz autentikatora (spec 01 §1.5).
 *
 * Zašto je drugi korak isti ekran, a ne odvojena stranica: pre-auth token živi 5 minuta i
 * NE SMIJE u URL ni u `localStorage` (dokaz je, ne podatak). Drži se samo u stanju
 * komponente, pa se prijava sa 2FA ne može „nastaviti" iz druge kartice — i ne treba.
 */
import { useRouter } from "next/navigation";
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication, WebAuthnAbortService, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { useEffect, useRef, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { isTwoFactorRequired, type LoginResponse } from "@gradix/contracts";
import { Alert, Button, Input, Stack } from "@/components/ui/index";

type State =
  | { kind: "idle" }
  | { kind: "error"; message: string; retryAfter?: number }
  /** Lozinka je tačna; čeka se kod iz autentikatora ili recovery kod. */
  | { kind: "twoFactor"; preAuthToken: string; error?: string };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  // `busy` je odvojeno od faze: dok kod putuje, korisnik mora ostati na formi za kod,
  // a ne pasti na formu za lozinku (prva verzija je radila upravo to).
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [code, setCode] = useState("");
  const [passkeysSupported, setPasskeysSupported] = useState(false);
  const ceremony = useRef(0);
  // The options response sets an HttpOnly challenge cookie. Serializing requests prevents
  // a late conditional response from overwriting the cookie for an explicit ceremony.
  const optionsTail = useRef<Promise<void>>(Promise.resolve());

  function cancelPasskey() {
    ceremony.current += 1;
    WebAuthnAbortService.cancelCeremony();
  }

  async function passkeyOptions(emailAddress?: string) {
    const previous = optionsTail.current;
    let release!: () => void;
    optionsTail.current = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await apiCall<{options: PublicKeyCredentialRequestOptionsJSON}>(
        "/api/auth/passkeys/login/options", jsonBody(emailAddress ? { email: emailAddress } : {}),
      );
    } finally { release(); }
  }

  async function runPasskey(emailAddress: string | undefined, autofill: boolean, generation: number) {
    try {
      const options = await passkeyOptions(emailAddress);
      if (generation !== ceremony.current) return;
      if (!options.ok) { if (!autofill) setState({ kind: "error", message: options.message }); return; }
      const credential = await startAuthentication({ optionsJSON: options.data.options, useBrowserAutofill: autofill });
      if (generation !== ceremony.current) return;
      setBusy(true);
      const result = await apiCall<{mustChangePassword: boolean}>(
        "/api/auth/passkeys/login/verify", jsonBody({ ...(emailAddress ? { email: emailAddress } : {}), credential }),
      );
      if (generation !== ceremony.current) return;
      if (!result.ok) { setState({ kind: "error", message: result.message }); return; }
      router.replace(result.data.mustChangePassword ? "/lozinka/promjena" : "/pregled");
      router.refresh();
    } catch {
      if (!autofill && generation === ceremony.current) setState({ kind: "error", message: "Passkey prijava nije dovršena. Pokušajte ponovo ili koristite lozinku." });
    } finally { if (generation === ceremony.current) setBusy(false); }
  }

  useEffect(() => {
    const supported = browserSupportsWebAuthn();
    setPasskeysSupported(supported);
    const generation = ++ceremony.current;
    if (supported) void browserSupportsWebAuthnAutofill().then(available => {
      if (available && generation === ceremony.current) void runPasskey(undefined, true, generation);
    }).catch(() => { /* Password and the explicit button remain available. */ });
    return () => { ceremony.current += 1; WebAuthnAbortService.cancelCeremony(); };
  // Initialize conditional mediation once per mounted login page.
  }, []);

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

  /*
   * Drugi korak: kod ide u ZAGLAVLJU `x-gx-2fa` (nikad u tijelu ni URL-u — ne smije u log).
   * `enrolling` znači da nalog još nema 2FA: tada `/auth/2fa/login` odbija kod i izdaje
   * sesiju samo za uparivanje, pa korisnik ide na Postavke → Sigurnost.
   */
  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (state.kind !== "twoFactor") return;
    const preAuthToken = state.preAuthToken;
    setBusy(true);
    const result = await apiCall<{ mustChangePassword?: boolean; enrollmentRequired?: boolean }>(
      "/api/auth/2fa/login",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-gx-2fa": state.preAuthToken },
        body: JSON.stringify({ code: code.trim() }),
      },
    );
    setBusy(false);
    if (!result.ok) {
      // Ključno: pre-auth token ostaje u stanju, pa promašen kod ne izbacuje na početak.
      setState({ kind: "twoFactor", preAuthToken, error: result.message });
      return;
    }
    if (result.data?.enrollmentRequired) {
      router.replace("/ured/postavke?tab=sigurnost");
      router.refresh();
      return;
    }
    router.replace(result.data?.mustChangePassword ? "/lozinka/promjena" : "/pregled");
    router.refresh();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    cancelPasskey();
    setBusy(true);
    // Tip dolazi iz ugovora (unija: puna sesija ili 2FA vrata) — ekran ne pogađa oblik.
    const result = await apiCall<LoginResponse>("/api/auth/login", jsonBody({ email, password }));
    setBusy(false);
    if (!result.ok) {
      // Kad je limit aktivan, poruka nosi stvarni broj sekundi (retry-after); ekran ga
      // odbrojava sam, da korisnik ne troši pokušaje pogađajući kad smije ponovo.
      setState({ kind: "error", message: result.message, ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}) });
      return;
    }
    // 2FA: lozinka je tačna, sesije JOŠ nema. Prelazimo na unos koda.
    if (isTwoFactorRequired(result.data)) {
      const { preAuthToken, twoFactor } = result.data;
      setState({ kind: "twoFactor", preAuthToken });
      // Uparivanje nema kod koji bi se unio — potvrda ide odmah, a ekran objašnjava zašto.
      if (twoFactor.gate === "ENROLL") await enrollNow(preAuthToken);
      return;
    }
    // Obavezna promjena lozinke ide prije bilo čega drugog.
    router.replace(result.data.mustChangePassword ? "/lozinka/promjena" : "/pregled");
    router.refresh();
  }

  function submitPasskey() {
    cancelPasskey();
    setBusy(true);
    void runPasskey(email.trim() || undefined, false, ceremony.current);
  }

  /** Sesija za uparivanje: dobija se bez koda, ali vidi samo Postavke → Sigurnost. */
  async function enrollNow(preAuthToken: string) {
    setBusy(true);
    const result = await apiCall<{ enrollmentRequired?: boolean }>("/api/auth/2fa/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gx-2fa": preAuthToken },
      body: JSON.stringify({ code: "" }),
    });
    if (result.ok && result.data?.enrollmentRequired) {
      router.replace("/ured/postavke?tab=sigurnost");
      router.refresh();
      return;
    }
    setBusy(false);
    setState({ kind: "error", message: result.ok ? "Prijava nije dovršena." : result.message });
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

        {state.kind === "twoFactor" ? (
          <form onSubmit={submitCode} noValidate>
            <Stack>
              <Alert tone="info">
                Lozinka je ispravna. Upišite <strong>šestocifreni kod</strong> iz autentikator
                aplikacije (ili jedan od recovery kodova).
              </Alert>
              <Input
                label="Kod iz autentikatora ili recovery kod"
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              {state.error ? (
                <Alert tone="error" role="alert">{state.error}</Alert>
              ) : null}
              <Button type="submit" variant="primary" fullWidthOnMobile className="gx-btn--block" disabled={busy || code.trim().length < 6}>
                {busy ? "Provjera…" : "Potvrdi kod"}
              </Button>
              <Button
                type="button"
                variant="quiet"
                fullWidthOnMobile
                disabled={busy}
                onClick={() => {
                  setCode("");
                  setPassword("");
                  setState({ kind: "idle" });
                }}
              >
                Nazad na prijavu
              </Button>
            </Stack>
          </form>
        ) : (
          <form onSubmit={submit} noValidate>
            <Stack>
              <Input label="Email" id="email" name="email" type="email" autoComplete="username webauthn" required value={email} onChange={(event) => setEmail(event.target.value)} />
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
                disabled={busy || secondsLeft > 0}
                className="gx-btn--block"
              >
                {busy ? "Prijava…" : "Prijavi se"}
              </Button>
              <Button type="button" variant="quiet" fullWidthOnMobile disabled={busy || secondsLeft > 0 || !passkeysSupported} onClick={submitPasskey}>
                Prijavi se pomoću Passkey-ja (otisak / Face ID)
              </Button>
              {!passkeysSupported ? <p>Passkeys nisu dostupni u ovom pregledniku ili uređaju. Prijavite se lozinkom.</p> : null}
            </Stack>
          </form>
        )}

        <p className="gx-page-sub">
          Zaboravljena lozinka? Obratite se administratoru firme — on izdaje jednokratni link.
        </p>
      </div>
    </main>
  );
}

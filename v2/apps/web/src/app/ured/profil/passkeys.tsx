"use client";
import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { describeDevice } from "@gradix/domain";
import { useEffect, useRef, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { Alert, Button, Card, Dialog, Input, SectionTitle, Stack } from "@/components/ui/index";

type Key = { id: string; deviceName: string; createdAt: string; lastUsedAt: string | null };
export function Passkeys() {
  const [keys,setKeys]=useState<Key[]>([]),[supported,setSupported]=useState(false),[busy,setBusy]=useState(false);
  const [open,setOpen]=useState(false),[totpEnabled,setTotpEnabled]=useState<boolean | null>(null);
  const [deviceName,setDeviceName]=useState(""),[password,setPassword]=useState(""),[code,setCode]=useState("");
  const [message,setMessage]=useState(""),[error,setError]=useState("");
  const trigger=useRef<HTMLButtonElement>(null);
  async function load() {
    const result=await apiCall<{passkeys:Key[]}>("/api/auth/passkeys");
    if(result.ok) setKeys(result.data.passkeys); else setError(result.message);
  }
  useEffect(()=>{setSupported(browserSupportsWebAuthn());void load();},[]);
  function start() {
    setDeviceName(describeDevice(navigator.userAgent));setPassword("");setCode("");setError("");setMessage("");setTotpEnabled(null);setOpen(true);
    void apiCall<{enabled:boolean}>("/api/auth/2fa/status").then(result=>{if(result.ok) setTotpEnabled(result.data.enabled);});
  }
  function close() { if(!busy){setOpen(false);setPassword("");setCode("");setError("");} }
  async function register(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError("");setMessage("");
    try {
      const options=await apiCall<{options:PublicKeyCredentialCreationOptionsJSON}>("/api/auth/passkeys/register/options",jsonBody({password,code}));
      if(!options.ok){setError(options.message);return;}
      const credential=await startRegistration({optionsJSON:options.data.options});
      const result=await apiCall<{ok:boolean}>("/api/auth/passkeys/register/verify",jsonBody({deviceName,credential}));
      if(!result.ok){setError(result.message);return;}
      setOpen(false);setDeviceName("");setPassword("");setCode("");setMessage("Passkey je registrovan.");await load();
    } catch {setError("Registracija nije dovršena. Pokušajte ponovo ili provjerite podršku uređaja.");}
    finally{setBusy(false);}
  }
  async function remove(id:string) {
    setBusy(true);setError("");setMessage("");
    const result=await apiCall<{ok:boolean}>(`/api/auth/passkeys/${encodeURIComponent(id)}`,{method:"DELETE"});
    if(result.ok){setMessage("Passkey je obrisan.");await load();}else setError(result.message);
    setBusy(false);
  }
  return <Card><SectionTitle>Passkeys</SectionTitle><Stack>
    <p>Prijavite se otiskom prsta, prepoznavanjem lica ili sigurnosnim ključem.</p>
    {error && !open ? <Alert tone="error" role="alert">{error}</Alert> : null}
    {message ? <Alert tone="success" role="status">{message}</Alert> : null}
    {keys.length ? <ul>{keys.map(key=><li key={key.id}>
      <strong>{key.deviceName}</strong> — dodan: {new Date(key.createdAt).toLocaleDateString("bs-BA")}; zadnja upotreba: {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString("bs-BA") : "nikad"}{" "}
      <Button type="button" variant="quiet" disabled={busy} onClick={()=>void remove(key.id)} aria-label={`Obriši passkey ${key.deviceName}`}>Obriši</Button>
    </li>)}</ul> : <p>Još nemate dodan passkey.</p>}
    <Button type="button" variant="primary" disabled={busy || !supported} onClick={event=>{trigger.current=event.currentTarget;start();}}>Dodaj passkey</Button>
    {!supported ? <p>Na ovom uređaju passkey nije dostupan. Možete se prijaviti lozinkom.</p> : null}
    {open ? <Dialog trapFocus title="Dodaj passkey" hint="Potvrdite identitet, zatim slijedite upute na uređaju." onClose={close} returnFocusTo={trigger.current}>
      <form onSubmit={register}><Stack>
        <Input label="Naziv uređaja" id="passkey-name" value={deviceName} onChange={event=>setDeviceName(event.target.value)} maxLength={100} required />
        <Input label="Trenutna lozinka" id="passkey-password" type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required />
        {totpEnabled !== false ? <Input label={totpEnabled ? "Kod iz autentikatora" : "Kod iz autentikatora (ako je 2FA uključena)"} id="passkey-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event=>setCode(event.target.value)} required={totpEnabled === true} /> : null}
        {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
        <Button type="submit" variant="primary" disabled={busy || !deviceName.trim() || !password || (totpEnabled === true && !code.trim())}>{busy ? "Potvrđivanje…" : "Potvrdi i dodaj passkey"}</Button>
        <Button type="button" variant="quiet" disabled={busy} onClick={close}>Odustani</Button>
      </Stack></form>
    </Dialog> : null}
  </Stack></Card>;
}

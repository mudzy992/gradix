"use client";
import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { Alert, Button, Card, Input, SectionTitle, Stack } from "@/components/ui/index";

type Key = { id: string; deviceName: string; createdAt: string; lastUsedAt: string | null };
export function Passkeys() {
  const [keys,setKeys]=useState<Key[]>([]),[supported,setSupported]=useState(false),[busy,setBusy]=useState(false);
  const [deviceName,setDeviceName]=useState(""),[password,setPassword]=useState(""),[code,setCode]=useState("");
  const [message,setMessage]=useState(""),[error,setError]=useState("");
  async function load() {
    const result=await apiCall<{passkeys:Key[]}>("/api/auth/passkeys");
    if(result.ok) setKeys(result.data.passkeys); else setError(result.message);
  }
  useEffect(()=>{setSupported(browserSupportsWebAuthn());void load();},[]);
  async function register(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError("");setMessage("");
    try {
      const options=await apiCall<{options:PublicKeyCredentialCreationOptionsJSON}>("/api/auth/passkeys/register/options",jsonBody({password,code}));
      if(!options.ok){setError(options.message);return;}
      const credential=await startRegistration({optionsJSON:options.data.options});
      const result=await apiCall<{ok:boolean}>("/api/auth/passkeys/register/verify",jsonBody({deviceName,credential}));
      if(!result.ok){setError(result.message);return;}
      setDeviceName("");setPassword("");setCode("");setMessage("Passkey je registrovan.");await load();
    } catch {setError("Registracija nije dovršena. Provjerite podršku uređaja i pokušajte ponovo.");}
    finally{setBusy(false);}
  }
  async function remove(id:string) {
    setBusy(true);setError("");setMessage("");
    const result=await apiCall<{ok:boolean}>(`/api/auth/passkeys/${encodeURIComponent(id)}`,{method:"DELETE"});
    if(result.ok){setMessage("Passkey je obrisan.");await load();}else setError(result.message);
    setBusy(false);
  }
  return <Card><SectionTitle>Passkeys (sigurnosni ključevi)</SectionTitle><Stack>
    <p>Registrujte otisak, Face ID ili sigurnosni ključ. Za registraciju je potrebna ponovna prijava lozinkom i, ako je uključena, 2FA kodom.</p>
    {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
    {message ? <Alert tone="success" role="status">{message}</Alert> : null}
    {keys.length ? <ul>{keys.map(key=><li key={key.id}>{key.deviceName} — zadnja upotreba: {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString("bs-BA") : "nikad"}{" "}<Button type="button" variant="quiet" disabled={busy} onClick={()=>void remove(key.id)} aria-label={`Obriši passkey ${key.deviceName}`}>Obriši</Button></li>)}</ul> : <p>Nemate registrovanih passkeys.</p>}
    <form onSubmit={register}><Stack>
      <Input label="Naziv uređaja" id="passkey-name" value={deviceName} onChange={event=>setDeviceName(event.target.value)} maxLength={100} required />
      <Input label="Trenutna lozinka" id="passkey-password" type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required />
      <Input label="Kod iz autentikatora (ako je 2FA uključena)" id="passkey-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event=>setCode(event.target.value)} />
      <Button type="submit" variant="primary" disabled={busy || !supported || !deviceName.trim() || !password}>Dodaj passkey</Button>
      {!supported ? <p>Ovaj preglednik ili uređaj ne podržava WebAuthn.</p> : null}
    </Stack></form>
  </Stack></Card>;
}

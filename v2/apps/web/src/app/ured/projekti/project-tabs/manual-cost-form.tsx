"use client";
import { useRef, useState } from "react";
import type { ManualCostInput } from "@gradix/contracts";
import { apiCall, jsonBody } from "@/api-client";
import { Alert, Button, Dialog, Input, Select, Textarea } from "@/components/ui";
import type { CategoryRow } from "@/server/project-budget-types";

async function upload(projectId:string,file:File):Promise<string> {
  const buffer=new Uint8Array(await file.arrayBuffer());
  const digest=await crypto.subtle.digest("SHA-256",buffer);
  const sha256=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
  const register=await apiCall<{attachment:{id:string};uploadUrl:string}>("/api/attachments",jsonBody({entityType:"PROJECT",entityId:projectId,fileName:file.name,sizeBytes:file.size,sha256,headBase64:btoa(String.fromCharCode(...buffer.slice(0,32)))}));
  if(!register.ok) throw new Error(register.message);
  const put=await fetch(register.data.uploadUrl,{method:"PUT",headers:{"content-type":file.type || "application/octet-stream"},body:buffer});
  if(!put.ok) throw new Error("Prilog nije učitan. Pokušajte ponovo.");
  const confirmed=await apiCall(`/api/attachments/${encodeURIComponent(register.data.attachment.id)}/confirm`,{method:"POST"});
  if(!confirmed.ok) throw new Error(confirmed.message);
  return register.data.attachment.id;
}

export function ManualCostForm({projectId,categories,currency,onClose,onSaved}:{projectId:string;categories:CategoryRow[];currency:string;onClose:()=>void;onSaved:(message:string)=>Promise<void>}) {
  const [form,setForm]=useState({categoryId:categories[0]?.id ?? "",occurredOn:new Date().toISOString().slice(0,10),amount:"",currencyCode:currency === "EUR" ? "EUR" : currency === "USD" ? "USD" : "BAM",quantity:"",unit:"",note:""});
  const [file,setFile]=useState<File|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [locked,setLocked]=useState(false);
  const id=useRef<string|null>(null);
  const snapshot=useRef<ManualCostInput|null>(null);
  const uploaded=useRef<string|null>(null);
  const submitted=useRef(false);
  const inFlight=useRef(false);
  async function submit(event:React.FormEvent) {
    event.preventDefault();
    if(inFlight.current) return;
    inFlight.current=true; setBusy(true); setError(null);
    try {
      if(!snapshot.current) {
        const attachmentId=file ? (uploaded.current ?? await upload(projectId,file)) : null;
        uploaded.current=attachmentId;
        id.current ??= crypto.randomUUID();
        snapshot.current={clientGeneratedId:id.current,projectId,categoryId:form.categoryId,phaseId:null,occurredOn:form.occurredOn,amount:form.amount,currencyCode:form.currencyCode as "BAM"|"EUR"|"USD",quantity:form.quantity ? Number(form.quantity) : undefined,unit:form.unit.trim() || null,note:form.note.trim() || null,attachmentId};
      }
      submitted.current=true; setLocked(true);
      const result=await apiCall<{approvalStatus:"PENDING"|"APPROVED"|"REJECTED"}>("/api/costs/manual",jsonBody(snapshot.current));
      if(!result.ok) {
        if(result.code === "VALIDATION_FAILED" || result.code === "FORBIDDEN" || result.code === "NOT_FOUND") {
          snapshot.current=null; submitted.current=false; setLocked(false); setError(result.message);
        } else { setError(`${result.message} Za siguran pokušaj ponovo pošaljite iste podatke. Prije novog unosa provjerite postojeće zahtjeve.`); }
        return;
      }
      const message=result.data.approvalStatus==="PENDING" ? "Zahtjev čeka odobrenje; trošak još nije knjižen." : result.data.approvalStatus==="REJECTED" ? "Zahtjev je odbijen; trošak nije knjižen." : "Trošak je knjižen. Ispravka ide kroz storno.";
      submitted.current=false; await onSaved(message);
    } catch {
      setError("Prilog ili zahtjev nije moguće poslati. Provjerite vezu i pokušajte ponovo.");
    } finally { inFlight.current=false; setBusy(false); }
  }
  function close() {
    if(busy) return;
    if(submitted.current && !window.confirm("Ishod zahtjeva nije potvrđen. Prije novog unosa provjerite troškove i zahtjeve na čekanju. Zatvoriti?")) return;
    onClose();
  }
  return <Dialog title="Ručni trošak" onClose={close}>
    <form className="gx-stack" onSubmit={submit}>
      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
      <fieldset disabled={busy || locked} className="gx-stack">
        <Select label="Kategorija" required value={form.categoryId} onChange={e=>setForm({...form,categoryId:e.target.value})}>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Input label="Datum troška" type="date" required value={form.occurredOn} onChange={e=>setForm({...form,occurredOn:e.target.value})} />
        <Input label="Iznos" required inputMode="decimal" hint="Iznad praga firme zahtjev čeka odobrenje (podrazumijevano 500 KM)." value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} />
        <Select label="Valuta" value={form.currencyCode} onChange={e=>setForm({...form,currencyCode:e.target.value})}><option value="BAM">BAM</option><option value="EUR">EUR</option><option value="USD">USD</option></Select>
        <Input label="Količina (opciono)" inputMode="decimal" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})} />
        <Input label="Jedinica (opciono)" maxLength={10} value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} />
        <Textarea label="Napomena" rows={2} maxLength={1000} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} />
        <Input label="Prilog računa (opciono)" type="file" accept="image/*,application/pdf" onChange={e=>{uploaded.current=null;setFile(e.target.files?.[0] ?? null);}} />
      </fieldset>
      <div className="gx-inline-flex gx-mt-2"><Button variant="quiet" disabled={busy} onClick={close}>Otkaži</Button><Button type="submit" variant="primary" disabled={busy || !form.categoryId}>{locked ? "Ponovi slanje" : "Pošalji trošak"}</Button></div>
    </form>
  </Dialog>;
}

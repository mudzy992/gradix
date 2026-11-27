"use client";
import { useEffect, useState } from "react";
import { apiCall } from "@/api-client";
import { Alert, Button, Card, FormGrid, FormSection, Input, SelectField as Select } from "@/components/ui";
import { usePurchasePost } from "../nabavka/use-purchase-post";
import type { Contract, Partner, Project } from "./subcontract-types";

type Props={contracts:Contract[];partners:Partner[];projects:Project[];onDone:(message:string)=>Promise<void>};
const currencies=<><option value="BAM">BAM</option><option value="EUR">EUR</option><option value="USD">USD</option></>;
function ErrorNotice({error}:{error:string|null}) { return error ? <Alert tone="error" role="alert">{error}</Alert>:null; }
export function ContractForm({partners,projects,onDone}:Props) {
  const [f,set]=useState({project:"",partner:"",code:"",title:"",value:"",currency:"BAM",retention:"0",warranty:"0"});
  const send=usePurchasePost(onDone);
  return <Card><FormSection title="Novi ugovor"><p>Prikazuju se partneri s aktivnom primarnom ili dodatnom ulogom podizvođača. Iznosi u unosu su feninga.</p><ErrorNotice error={send.error}/>
    <form onSubmit={e=>{e.preventDefault();void send.post("/api/subcontractor-contracts",{clientGeneratedId:crypto.randomUUID(),projectId:f.project,partnerId:f.partner,code:f.code,title:f.title,contractValueCents:f.value,currencyCode:f.currency,retentionPct:f.retention,warrantyPct:f.warranty},"Nacrt ugovora je sačuvan.");}}>
      <fieldset className="gx-stack" disabled={send.busy || send.locked}><FormGrid>
        <Select label="Projekat ugovora" required value={f.project} onChange={e=>set({...f,project:e.target.value})}><option value="">Odaberite</option>{projects.map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select>
        <Select label="Podizvođač" required value={f.partner} onChange={e=>set({...f,partner:e.target.value})}><option value="">Odaberite</option>{partners.map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select>
        <Input label="Šifra ugovora" required maxLength={100} value={f.code} onChange={e=>set({...f,code:e.target.value})}/>
        <Input label="Naziv ugovora" required maxLength={300} value={f.title} onChange={e=>set({...f,title:e.target.value})}/>
        <Input label="Vrijednost ugovora (feninga)" required inputMode="numeric" pattern="[0-9]+" value={f.value} onChange={e=>set({...f,value:e.target.value})}/>
        <Select label="Valuta ugovora" value={f.currency} onChange={e=>set({...f,currency:e.target.value})}>{currencies}</Select>
        <Input label="Zadržavanje (%)" required inputMode="decimal" value={f.retention} onChange={e=>set({...f,retention:e.target.value})}/>
        <Input label="Garancija (%)" required inputMode="decimal" value={f.warranty} onChange={e=>set({...f,warranty:e.target.value})}/>
      </FormGrid></fieldset><Button type="submit" variant="primary" disabled={send.busy}>{send.locked ? "Ponovi slanje ugovora" : "Sačuvaj ugovor"}</Button>
    </form></FormSection></Card>;
}
export function AmendmentForm({contracts,onDone}:Props) {
  const [f,set]=useState({contract:"",value:"",reason:""});const send=usePurchasePost(onDone);
  return <Card><FormSection title="Novi aneks"><p>Aneks povećava vrijednost aktivnog ugovora i bilježi razlog u auditu.</p><ErrorNotice error={send.error}/>
    <form onSubmit={e=>{e.preventDefault();void send.post(`/api/subcontractor-contracts/${encodeURIComponent(f.contract)}/amend`,{clientGeneratedId:crypto.randomUUID(),valueAmendmentCents:f.value,reason:f.reason},"Aneks je sačuvan.");}}>
      <fieldset className="gx-stack" disabled={send.busy || send.locked}><FormGrid>
        <Select label="Ugovor za aneks" required value={f.contract} onChange={e=>set({...f,contract:e.target.value})}><option value="">Odaberite</option>{contracts.filter(c=>c.status==="ACTIVE").map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</Select>
        <Input label="Povećanje vrijednosti (feninga)" required inputMode="numeric" pattern="[0-9]+" value={f.value} onChange={e=>set({...f,value:e.target.value})}/>
        <Input label="Razlog aneksa" required minLength={10} maxLength={1000} value={f.reason} onChange={e=>set({...f,reason:e.target.value})}/>
      </FormGrid></fieldset><Button type="submit" variant="primary" disabled={send.busy}>{send.locked ? "Ponovi slanje aneksa" : "Sačuvaj aneks"}</Button>
    </form></FormSection></Card>;
}
export function StatementForm({contracts,onDone}:Props) {
  const [f,set]=useState({contract:"",phase:"",number:"",from:"",to:"",description:"",amount:""});const send=usePurchasePost(onDone);
  const [phases,setPhases]=useState<{id:string;name:string}[]>([]);const [error,setError]=useState<string|null>(null);
  const contract=contracts.find(c=>c.id===f.contract);
  useEffect(()=>{setPhases([]);setError(null);if(!contract)return;let active=true;
    void apiCall<{phases:{id:string;name:string}[]}>(`/api/projects/${encodeURIComponent(contract.project_id)}/phases`).then(r=>{if(active){if(r.ok)setPhases(r.data.phases);else setError(r.message);}});
    return ()=>{active=false;};},[contract?.project_id]);
  return <Card><FormSection title="Nova situacija"><p>Bruto i odbici obračunavaju se na serveru prema ugovoru. Prikazana prekoračenja ne blokiraju odobrenje.</p><ErrorNotice error={send.error || error}/>
    <form onSubmit={e=>{e.preventDefault();void send.post("/api/subcontractor-statements",{clientGeneratedId:crypto.randomUUID(),contractId:f.contract,phaseId:f.phase || null,statementNo:f.number,periodFrom:f.from,periodTo:f.to,items:[{description:f.description,amountCents:f.amount}]},"Situacija je predana.");}}>
      <fieldset className="gx-stack" disabled={send.busy || send.locked}><FormGrid>
        <Select label="Ugovor za situaciju" required value={f.contract} onChange={e=>set({...f,contract:e.target.value,phase:""})}><option value="">Odaberite</option>{contracts.filter(c=>c.status==="ACTIVE").map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</Select>
        <Select label="Faza situacije" value={f.phase} onChange={e=>set({...f,phase:e.target.value})}><option value="">Bez faze</option>{phases.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Input label="Broj situacije" required maxLength={100} value={f.number} onChange={e=>set({...f,number:e.target.value})}/>
        <Input label="Period od" type="date" required value={f.from} onChange={e=>set({...f,from:e.target.value})}/>
        <Input label="Period do" type="date" required value={f.to} onChange={e=>set({...f,to:e.target.value})}/>
        <Input label="Opis radova" required maxLength={500} value={f.description} onChange={e=>set({...f,description:e.target.value})}/>
        <Input label="Bruto iznos situacije (feninga)" required inputMode="numeric" pattern="[0-9]+" value={f.amount} onChange={e=>set({...f,amount:e.target.value})}/>
      </FormGrid></fieldset><Button type="submit" variant="primary" disabled={send.busy}>{send.locked ? "Ponovi slanje situacije" : "Predaj situaciju"}</Button>
    </form></FormSection></Card>;
}

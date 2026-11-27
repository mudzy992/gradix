"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiCall, jsonBody, patchBody } from "@/api-client";
import { Alert, Button, DataTable, Dialog, Select, Stack, Tabs } from "@/components/ui";
import { AmendmentForm, ContractForm, StatementForm } from "./subcontract-forms";
import { money, type Amendment, type Contract, type Partner, type Project, type Statement } from "./subcontract-types";

export function SubcontractClient({canManage,partners}:{canManage:boolean;partners:Partner[]}) {
  const [tab,setTab]=useState("contracts");const [dialog,setDialog]=useState<string|null>(null);
  const [formVersion,setFormVersion]=useState<Record<string,number>>({});const trigger=useRef<HTMLElement|null>(null);
  const [contracts,setContracts]=useState<Contract[]>([]);const [statements,setStatements]=useState<Statement[]>([]);const [projects,setProjects]=useState<Project[]>([]);
  const [selected,setSelected]=useState("");const [amendments,setAmendments]=useState<Amendment[]>([]);const [amendError,setAmendError]=useState<string|null>(null);
  const [notice,setNotice]=useState<{tone:"success"|"error";text:string}|null>(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const inFlight=useRef(false);const amendmentRequest=useRef(0);
  const load=useCallback(async()=>{
    const [c,s,p]=await Promise.all([apiCall<{contracts:Contract[]}>("/api/subcontractor-contracts"),apiCall<{statements:Statement[]}>("/api/subcontractor-statements"),apiCall<{projects:Project[]}>("/api/projects")]);
    if(c.ok)setContracts(c.data.contracts);if(s.ok)setStatements(s.data.statements);if(p.ok)setProjects(p.data.projects);
    const failures=[c,s,p].filter(r=>!r.ok);if(failures.length)setNotice({tone:"error",text:`Neki podaci nisu učitani: ${failures.map(r=>!r.ok ? r.message : "").join(" · ")}`});
    setLoading(false);return failures.length===0;
  },[]);
  const loadAmendments=useCallback(async(id:string)=>{
    const request=++amendmentRequest.current;
    if(!id){setAmendments([]);setAmendError(null);return;}
    const r=await apiCall<{amendments:Amendment[]}>(`/api/subcontractor-contracts/${encodeURIComponent(id)}/amend`);
    if(request!==amendmentRequest.current)return;
    if(r.ok){setAmendments(r.data.amendments);setAmendError(null);}else{setAmendments([]);setAmendError(r.message);}
  },[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{void loadAmendments(selected);},[selected,loadAmendments]);
  async function done(kind:string,message:string){setDialog(null);setFormVersion(current=>({...current,[kind]:(current[kind] ?? 0)+1}));const loaded=await load();await loadAmendments(selected);if(loaded)setNotice({tone:"success",text:message});}
  async function action(path:string,kind:"activate"|"approve") {
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setNotice(null);
    const result=await apiCall<{warnings?:string[]}>(path,kind==="activate" ? patchBody({status:"ACTIVE"}) : jsonBody({}));
    if(!result.ok)setNotice({tone:"error",text:result.message});
    else {const loaded=await load();if(loaded)setNotice({tone:"success",text:result.data.warnings?.includes("SUBCONTRACTOR_CONTRACT_EXCEEDED") ? "Situacija je odobrena. Upozorenje: zbir situacija premašuje ugovorenu vrijednost." : kind==="approve" ? "Situacija je odobrena i bruto trošak je knjižen." : "Ugovor je aktiviran."});}
    inFlight.current=false;setBusy(false);
  }
  function exceeded(row:Statement):boolean {
    const c=contracts.find(x=>x.id===row.contract_id);if(!c)return false;
    const approved=statements.filter(s=>s.contract_id===row.contract_id && ["APPROVED","PAID"].includes(s.status)).reduce((n,s)=>n+BigInt(s.gross_cents),0n);
    return row.status==="SUBMITTED" && approved+BigInt(row.gross_cents)>BigInt(c.contract_value_cents)+BigInt(c.amendment_cents);
  }
  const props={contracts,partners,projects};
  return <Stack>
    {notice ? <Alert tone={notice.tone} role={notice.tone==="error" ? "alert":"status"}>{notice.text}</Alert>:null}
    <p>Liste su ograničene na 500 zapisa; obračun i konačna provjera prekoračenja rade se na serveru pri odobrenju.</p>
    <Tabs label="Podizvođači" active={tab} onChange={setTab} tabs={[{key:"contracts",label:"Ugovori"},{key:"amendments",label:"Aneksi"},{key:"statements",label:"Situacije"}]} />
    <section hidden={tab !== "contracts"}>
    <h2>Ugovori</h2><DataTable caption="Ugovori podizvođača" rows={contracts} loading={loading} rowKey={r=>r.id} emptyText="Nema ugovora." columns={[
      {key:"name",header:"Ugovor",cell:r=>`${r.code} · ${r.title}`},{key:"project",header:"Projekat",cell:r=>projects.find(p=>p.id===r.project_id)?.name ?? r.project_id},
      {key:"partner",header:"Podizvođač",cell:r=>partners.find(p=>p.id===r.partner_id)?.name ?? r.partner_id},
      {key:"value",header:"Vrijednost s aneksima",cell:r=>`${money((BigInt(r.contract_value_cents)+BigInt(r.amendment_cents)).toString())} ${r.currency_code}`},
      {key:"retention",header:"Zadržavanje",cell:r=>`${r.retention_pct}%`},{key:"warranty",header:"Garancija",cell:r=>`${r.warranty_pct}%`},
      {key:"status",header:"Status",cell:r=>r.status},{key:"action",header:"Radnja",cell:r=>canManage && r.status==="DRAFT" ? <Button disabled={busy} onClick={()=>void action(`/api/subcontractor-contracts/${encodeURIComponent(r.id)}`,"activate")}>Aktiviraj</Button> : "—"},
    ]}/>
    {canManage ? <Button variant="primary" onClick={e=>{trigger.current=e.currentTarget;setDialog("contracts");}}>+ Novi ugovor</Button>:null}
    </section><section hidden={tab !== "amendments"}>
    <h2>Aneksi ugovora</h2><Select label="Pregled aneksa za ugovor" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Odaberite ugovor</option>{contracts.map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</Select>
    {amendError ? <Alert tone="error" role="alert">{amendError}</Alert>:null}
    {selected ? <DataTable caption="Aneksi odabranog ugovora" rows={amendments} rowKey={r=>r.id} emptyText="Nema aneksa." columns={[
      {key:"amount",header:"Povećanje",cell:r=>money(r.value_amendment_cents)}, {key:"reason",header:"Razlog",cell:r=>r.reason}, {key:"date",header:"Datum",cell:r=>r.created_at},
    ]}/>:null}
    {canManage ? <Button variant="primary" onClick={e=>{trigger.current=e.currentTarget;setDialog("amendments");}}>+ Novi aneks</Button>:null}
    </section><section hidden={tab !== "statements"}>
    <h2>Situacije</h2><DataTable caption="Situacije podizvođača" rows={statements} loading={loading} rowKey={r=>r.id} emptyText="Nema situacija." columns={[
      {key:"number",header:"Situacija",cell:r=>r.statement_no},{key:"contract",header:"Ugovor",cell:r=>contracts.find(c=>c.id===r.contract_id)?.code ?? r.contract_id},
      {key:"gross",header:"Bruto",cell:r=>`${money(r.gross_cents)} ${r.currency_code}`},
      {key:"retention",header:"Zadržavanje",cell:r=>`${r.retention_pct}% · ${money(r.retention_cents)} ${r.currency_code}`},
      {key:"warranty",header:"Garancija",cell:r=>`${r.warranty_pct}% · ${money(r.warranty_cents)} ${r.currency_code}`},
      {key:"net",header:"Neto za isplatu",cell:r=>`${money(r.net_cents)} ${r.currency_code}`},{key:"status",header:"Status",cell:r=>r.status},
      {key:"warning",header:"Upozorenje",cell:r=>r.exceeded_at_approval || exceeded(r) ? "Prekoračenje ugovora (odobrenje nije blokirano)" : "—"},
      {key:"action",header:"Radnja",cell:r=>canManage && r.status==="SUBMITTED" ? <Button disabled={busy} onClick={()=>void action(`/api/subcontractor-statements/${encodeURIComponent(r.id)}/approve`,"approve")}>Odobri situaciju</Button>:"—"},
    ]}/>
    {canManage ? <Button variant="primary" onClick={e=>{trigger.current=e.currentTarget;setDialog("statements");}}>+ Nova situacija</Button>:null}
    </section>
    {canManage ? <>
      <Dialog title="Novi ugovor" open={dialog === "contracts"} trapFocus returnFocusTo={trigger.current} onClose={()=>setDialog(null)}><ContractForm key={formVersion.contracts ?? 0} {...props} onDone={text=>done("contracts",text)}/></Dialog>
      <Dialog title="Novi aneks" open={dialog === "amendments"} trapFocus returnFocusTo={trigger.current} onClose={()=>setDialog(null)}><AmendmentForm key={formVersion.amendments ?? 0} {...props} onDone={text=>done("amendments",text)}/></Dialog>
      <Dialog title="Nova situacija" open={dialog === "statements"} trapFocus returnFocusTo={trigger.current} onClose={()=>setDialog(null)}><StatementForm key={formVersion.statements ?? 0} {...props} onDone={text=>done("statements",text)}/></Dialog>
    </>:null}
  </Stack>;
}

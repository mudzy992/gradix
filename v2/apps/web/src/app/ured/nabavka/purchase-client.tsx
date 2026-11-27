"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";
import { Alert, Button, DataTable, Dialog, Stack, Tabs } from "@/components/ui";
import type { Notice, Options, Issue, Invoice, Order, RequestRow, Receipt, Item, Warehouse, Partner, Project } from "./purchase-types";
import { InvoiceForm, OrderForm, ReceiptForm, RequestForm } from "./purchase-forms";

const empty:Options={items:[],warehouses:[],partners:[],projects:[],requests:[],orders:[],receipts:[]};
export function PurchaseClient({canManage,initialItem,initialWarehouse}:{canManage:boolean;initialItem:string;initialWarehouse:string}) {
  const [data,setData]=useState<Options>(empty);const [invoices,setInvoices]=useState<Invoice[]>([]);const [issues,setIssues]=useState<Issue[]>([]);
  const [tab,setTab]=useState("requests");
  const [dialog,setDialog]=useState<string | null>(canManage && initialItem ? "requests" : null);
  const [formVersion,setFormVersion]=useState<Record<string,number>>({});
  const trigger=useRef<HTMLElement | null>(null);
  const [notice,setNotice]=useState<Notice|null>(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const locked=useRef(false);
  const load=useCallback(async()=>{
    const [requests,orders,receipts,bills,material,items,warehouses,partners,projects]=await Promise.all([
      apiCall<{requests:RequestRow[]}>("/api/purchase-requests"),apiCall<{orders:Order[]}>("/api/purchase-orders"),
      apiCall<{receipts:Receipt[]}>("/api/goods-receipts"),apiCall<{invoices:Invoice[]}>("/api/purchase-invoices"),
      apiCall<{issues:Issue[]}>("/api/material-issues"),apiCall<{items:Item[]}>("/api/stock-items"),
      apiCall<{warehouses:Warehouse[]}>("/api/warehouses"),canManage ? apiCall<{partners:Partner[]}>("/api/partners") : Promise.resolve({ok:true as const,data:{partners:[] as Partner[]}}),apiCall<{projects:Project[]}>("/api/projects"),
    ]);
    const failures=[requests,orders,receipts,bills,material,items,warehouses,partners,projects].filter(r=>!r.ok);
    if(failures.length) setNotice({tone:"error",text:`Neke podatke nije moguće učitati: ${failures.map(r=>!r.ok ? r.message : "").join(" · ")}`});
    setData({requests:requests.ok ? requests.data.requests : [],orders:orders.ok ? orders.data.orders : [],receipts:receipts.ok ? receipts.data.receipts : [],items:items.ok ? items.data.items : [],warehouses:warehouses.ok ? warehouses.data.warehouses : [],partners:partners.ok ? partners.data.partners : [],projects:projects.ok ? projects.data.projects : []});
    if(bills.ok)setInvoices(bills.data.invoices);if(material.ok)setIssues(material.data.issues);setLoading(false);
  },[canManage]);
  useEffect(()=>{void load();},[load]);
  async function done(kind:string,text:string) {
    await load(); setNotice({tone:"success",text}); setDialog(null);
    setFormVersion(current=>({...current,[kind]:(current[kind] ?? 0)+1}));
  }
  async function action(path:string) {
    if(locked.current)return;locked.current=true;setBusy(true);setNotice(null);
    const result=await apiCall<{approvalRequired?:boolean;warnings?:string[]}>(path,jsonBody({}));
    if(!result.ok)setNotice({tone:"error",text:result.message});
    else {await load();setNotice({tone:"success",text:result.data.warnings?.includes("PURCHASE_INVOICE_MISMATCH") ? "PURCHASE_INVOICE_MISMATCH: račun se ne slaže s prijemom." : result.data.approvalRequired ? "Predano: potrebna je odluka vlasnika ili administratora." : "Radnja je uspješno izvršena."});}
    locked.current=false;setBusy(false);
  }
  return <Stack>
    {notice ? <Alert tone={notice.tone} role={notice.tone==="error" ? "alert":"status"}>{notice.text}</Alert>:null}
    <p>Liste prikazuju do 500 zapisa ili stavki. Cijene u tabelama su u feningima.</p>
    <Tabs label="Nabavka" active={tab} onChange={setTab} tabs={[
      {key:"requests",label:"Zahtjevi"},{key:"orders",label:"Narudžbenice"},{key:"receipts",label:"Prijemi"},
      {key:"invoices",label:"Računi"},{key:"issues",label:"Izlazi"},
    ]} />
    <section hidden={tab !== "requests"}>
    <h2>Zahtjevi nabavke</h2><p>Prag odobrenja određuje firma pri predaji; podrazumijevano 100.000 feninga (1.000 KM).</p>
    <DataTable caption="Zahtjevi nabavke" rows={data.requests} loading={loading} rowKey={r=>r.id} emptyText="Nema zahtjeva." columns={[
      {key:"description",header:"Obrazloženje",cell:r=>r.justification}, {key:"status",header:"Status",cell:r=>r.status}, {key:"amount",header:"Procjena (feninga)",cell:r=>`${r.total_estimated_cents} ${r.currency_code}`},
      {key:"threshold",header:"Prag pri predaji (feninga)",cell:r=>r.approval_threshold_cents ?? "Određuje se pri predaji"},
      {key:"actions",header:"Radnje",cell:r=>canManage && r.status==="DRAFT" ? <Button disabled={busy} onClick={()=>void action(`/api/purchase-requests/${encodeURIComponent(r.id)}/submit`)}>Predaj zahtjev</Button> : canManage && r.status==="SUBMITTED" ? <Button disabled={busy} onClick={()=>void action(`/api/purchase-requests/${encodeURIComponent(r.id)}/approve`)}>Odobri zahtjev</Button> : "—"},
    ]}/>
    {canManage ? <Button variant="primary" onClick={event=>{trigger.current=event.currentTarget;setDialog("requests");}}>+ Novi zahtjev</Button> : null}
    </section><section hidden={tab !== "orders"}>
    <h2>Narudžbenice</h2><DataTable caption="Narudžbenice" rows={data.orders} loading={loading} rowKey={r=>r.id} emptyText="Nema narudžbenica." columns={[
      {key:"id",header:"Narudžbenica",cell:r=>r.id},{key:"partner",header:"Dobavljač",cell:r=>data.partners.find(p=>p.id===r.partner_id)?.name ?? r.partner_id},
      {key:"status",header:"Status",cell:r=>r.status},{key:"amount",header:"Iznos (feninga)",cell:r=>`${r.total_cents} ${r.currency_code}`},
      {key:"action",header:"Radnja",cell:r=>canManage && r.status==="DRAFT" ? <Button disabled={busy} onClick={()=>void action(`/api/purchase-orders/${encodeURIComponent(r.id)}/send`)}>Pošalji narudžbenicu</Button>:"—"},
    ]}/>
    {canManage ? <Button variant="primary" onClick={event=>{trigger.current=event.currentTarget;setDialog("orders");}}>+ Nova narudžbenica</Button> : null}
    </section><section hidden={tab !== "receipts"}>
    <h2>Prijemi robe</h2><DataTable caption="Stavke prijema robe" rows={data.receipts} loading={loading} rowKey={r=>r.item_id} emptyText="Nema prijema." columns={[
      {key:"date",header:"Datum",cell:r=>r.received_at},{key:"item",header:"Artikal",cell:r=>r.item_name},
      {key:"qty",header:"Količina",cell:r=>`${r.quantity} ${r.unit}`},{key:"amount",header:"Iznos (feninga)",cell:r=>`${r.amount_cents} ${r.currency_code}`},
    ]}/>
    {canManage ? <Button variant="primary" onClick={event=>{trigger.current=event.currentTarget;setDialog("receipts");}}>+ Novi prijem</Button> : null}
    </section><section hidden={tab !== "invoices"}>
    <h2>Računi dobavljača</h2><DataTable caption="Računi dobavljača" rows={invoices} loading={loading} rowKey={r=>r.id} emptyText="Nema računa." columns={[
      {key:"number",header:"Račun",cell:r=>r.invoice_number},{key:"status",header:"Status",cell:r=>r.status},{key:"amount",header:"Iznos (feninga)",cell:r=>`${r.amount_cents} ${r.currency_code}`},
      {key:"warnings",header:"Upozorenja",cell:r=>r.warnings.includes("PURCHASE_INVOICE_MISMATCH") ? "PURCHASE_INVOICE_MISMATCH: račun se ne slaže s prijemom" : r.warnings.join(", ") || "—"},
      {key:"action",header:"Radnja",cell:r=>canManage && r.status==="PENDING" ? <Button disabled={busy} onClick={()=>void action(`/api/purchase-invoices/${encodeURIComponent(r.id)}/approve`)}>Odobri račun</Button> : "—"},
    ]}/>
    {canManage ? <Button variant="primary" onClick={event=>{trigger.current=event.currentTarget;setDialog("invoices");}}>+ Novi račun</Button> : null}
    </section><section hidden={tab !== "issues"}>
    <h2>Izlazi materijala</h2><DataTable caption="Izlazi materijala" rows={issues} loading={loading} rowKey={r=>r.id} emptyText="Nema izlaza." columns={[
      {key:"date",header:"Datum",cell:r=>r.issued_at},{key:"warehouse",header:"Skladište",cell:r=>r.warehouse_name},
      {key:"project",header:"Projekat",cell:r=>data.projects.find(p=>p.id===r.project_id)?.name ?? r.project_id ?? "Opći trošak"},
      {key:"amount",header:"Iznos (feninga)",cell:r=>`${r.amount_cents} ${r.currency_code}`},{key:"minimum",header:"Minimum",cell:r=>r.below_minimum ? "Ispod minimuma" : "—"},
    ]}/>
    </section>
    {canManage ? <>
      <Dialog title="Novi zahtjev za nabavku" open={dialog === "requests"} trapFocus returnFocusTo={trigger.current} onClose={()=>setDialog(null)}>
        <RequestForm key={formVersion.requests ?? 0} options={data} onDone={text=>done("requests",text)} initialItem={initialItem} initialWarehouse={initialWarehouse}/>
      </Dialog>
      <Dialog title="Nova narudžbenica" open={dialog === "orders"} trapFocus returnFocusTo={trigger.current} onClose={()=>setDialog(null)}>
        <OrderForm key={formVersion.orders ?? 0} options={data} onDone={text=>done("orders",text)}/>
      </Dialog>
      <Dialog title="Novi prijem" open={dialog === "receipts"} trapFocus returnFocusTo={trigger.current} onClose={()=>setDialog(null)}>
        <ReceiptForm key={formVersion.receipts ?? 0} options={data} onDone={text=>done("receipts",text)} initialWarehouse={initialWarehouse}/>
      </Dialog>
      <Dialog title="Novi račun" open={dialog === "invoices"} trapFocus returnFocusTo={trigger.current} onClose={()=>setDialog(null)}>
        <InvoiceForm key={formVersion.invoices ?? 0} options={data} onDone={text=>done("invoices",text)}/>
      </Dialog>
    </> : null}
  </Stack>;
}

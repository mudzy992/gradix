"use client";
import { useEffect, useState } from "react";
import { apiCall } from "@/api-client";
import { Alert, Button, Card, FormGrid, FormSection, Input, Select } from "@/components/ui";
import type { Options, RequestDetail, OrderDetail } from "./purchase-types";
import { usePurchasePost } from "./use-purchase-post";

type Props={options:Options;onDone:(message:string)=>Promise<void>};
const currencies=<><option value="BAM">BAM</option><option value="EUR">EUR</option><option value="USD">USD</option></>;
const uid=()=>crypto.randomUUID();
function Failure({error}:{error:string|null}) {return error ? <Alert tone="error" role="alert">{error}</Alert>:null;}
export function RequestForm({options,onDone,initialItem,initialWarehouse}:{initialItem:string;initialWarehouse:string}&Props) {
  const [f,set]=useState({project:"",item:initialItem,quantity:"",price:"",justification:"",currency:"BAM",needed:""});
  const sender=usePurchasePost(onDone);
  const warehouse=options.warehouses.find(w=>w.id===initialWarehouse);
  useEffect(()=>{if(warehouse?.project_id) set(x=>x.project ? x : {...x,project:warehouse.project_id!});},[warehouse?.project_id]);
  const item=options.items.find(i=>i.id===f.item);
  return <Card><FormSection title="Novi zahtjev za nabavku"><p>Procjena i cijene su u feningima. Firma određuje prag odobrenja; podrazumijevano 1.000 KM.</p>
    {warehouse ? <p>Prijedlog za skladište: {warehouse.name}. Potvrdite količinu i procijenjenu cijenu prije slanja.</p>:null}
    <Failure error={sender.error} /><form onSubmit={e=>{e.preventDefault();if(!item)return;void sender.post("/api/purchase-requests",{clientGeneratedId:uid(),projectId:f.project || null,neededBy:f.needed || null,justification:f.justification,currencyCode:f.currency,items:[{itemId:item.id,description:item.name,unit:item.unit,quantity:f.quantity,estimatedUnitPriceCents:f.price}]},"Nacrt zahtjeva je sačuvan.");}}>
      <fieldset className="gx-stack" disabled={sender.busy || sender.locked}><FormGrid>
        <Select label="Projekat zahtjeva" value={f.project} onChange={e=>set({...f,project:e.target.value})}><option value="">Opći zahtjev</option>{options.projects.map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select>
        <Select label="Artikal zahtjeva" required value={f.item} onChange={e=>set({...f,item:e.target.value})}><option value="">Odaberite</option>{options.items.filter(i=>i.is_active).map(i=><option key={i.id} value={i.id}>{i.code} · {i.name} ({i.unit})</option>)}</Select>
        <Input label="Količina zahtjeva" required inputMode="decimal" value={f.quantity} onChange={e=>set({...f,quantity:e.target.value})}/>
        <Input label="Procjena po jedinici (feninga)" required inputMode="numeric" pattern="[0-9]+" value={f.price} onChange={e=>set({...f,price:e.target.value})}/>
        <Input label="Potrebno do" type="date" value={f.needed} onChange={e=>set({...f,needed:e.target.value})}/>
        <Select label="Valuta zahtjeva" value={f.currency} onChange={e=>set({...f,currency:e.target.value})}>{currencies}</Select>
        <Input label="Obrazloženje" required maxLength={2000} value={f.justification} onChange={e=>set({...f,justification:e.target.value})}/>
      </FormGrid></fieldset><Button type="submit" variant="primary" disabled={sender.busy}>{sender.locked ? "Ponovi zahtjev" : "Sačuvaj nacrt zahtjeva"}</Button>
    </form></FormSection></Card>;
}

export function OrderForm({options,onDone}:Props) {
  const [f,set]=useState({request:"",partner:"",line:"",quantity:"",price:"",currency:"BAM",expected:""});
  const [detail,setDetail]=useState<RequestDetail|null>(null); const [loadError,setLoadError]=useState("");
  const sender=usePurchasePost(onDone);
  useEffect(()=>{setDetail(null);if(!f.request)return;let active=true;void apiCall<RequestDetail>(`/api/purchase-requests/${encodeURIComponent(f.request)}`).then(r=>{if(active){if(r.ok){setDetail(r.data);setLoadError("");}else setLoadError(r.message);}});return()=>{active=false;};},[f.request]);
  const line=detail?.items.find(i=>i.id===f.line);
  return <Card><FormSection title="Nova narudžbenica"><Failure error={sender.error || loadError}/><form onSubmit={e=>{e.preventDefault();if(!line?.item_id)return;void sender.post("/api/purchase-orders",{clientGeneratedId:uid(),requestId:f.request,partnerId:f.partner,expectedAt:f.expected || null,currencyCode:f.currency,items:[{requestItemId:line.id,itemId:line.item_id,description:line.description,unit:line.unit,quantity:f.quantity,unitPriceCents:f.price}]},"Nacrt narudžbenice je sačuvan.");}}>
    <fieldset className="gx-stack" disabled={sender.busy || sender.locked}><FormGrid>
      <Select label="Odobreni zahtjev" required value={f.request} onChange={e=>set({...f,request:e.target.value,line:""})}><option value="">Odaberite</option>{options.requests.filter(r=>r.status==="APPROVED").map(r=><option key={r.id} value={r.id}>{r.justification} · {r.id}</option>)}</Select>
      <Select label="Stavka zahtjeva" required value={f.line} onChange={e=>set({...f,line:e.target.value})}><option value="">Odaberite</option>{detail?.items.filter(i=>i.item_id).map(i=><option key={i.id} value={i.id}>{i.description} · {i.quantity} {i.unit}</option>)}</Select>
      <Select label="Dobavljač narudžbenice" required value={f.partner} onChange={e=>set({...f,partner:e.target.value})}><option value="">Odaberite</option>{options.partners.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      <Input label="Količina narudžbe" required inputMode="decimal" value={f.quantity} onChange={e=>set({...f,quantity:e.target.value})}/>
      <Input label="Cijena po jedinici (feninga)" required inputMode="numeric" pattern="[0-9]+" value={f.price} onChange={e=>set({...f,price:e.target.value})}/>
      <Select label="Valuta narudžbenice" value={f.currency} onChange={e=>set({...f,currency:e.target.value})}>{currencies}</Select>
      <Input label="Očekivani datum" type="date" value={f.expected} onChange={e=>set({...f,expected:e.target.value})}/>
    </FormGrid></fieldset><Button type="submit" variant="primary" disabled={sender.busy}>{sender.locked ? "Ponovi narudžbu" : "Sačuvaj narudžbenicu"}</Button>
  </form></FormSection></Card>;
}

export function ReceiptForm({options,onDone,initialWarehouse}:{initialWarehouse:string}&Props) {
  const [f,set]=useState({order:"",line:"",warehouse:initialWarehouse,quantity:"",price:""}); const [detail,setDetail]=useState<OrderDetail|null>(null); const [loadError,setLoadError]=useState("");
  const sender=usePurchasePost(onDone);
  useEffect(()=>{setDetail(null);if(!f.order)return;let active=true;void apiCall<OrderDetail>(`/api/purchase-orders/${encodeURIComponent(f.order)}`).then(r=>{if(active){if(r.ok){setDetail(r.data);setLoadError("");}else setLoadError(r.message);}});return()=>{active=false;};},[f.order]);
  const line=detail?.items.find(i=>i.id===f.line);
  return <Card><FormSection title="Prijem robe"><Failure error={sender.error || loadError}/><form onSubmit={e=>{e.preventDefault();if(!line || !detail)return;void sender.post("/api/goods-receipts",{clientGeneratedId:uid(),orderId:f.order,partnerId:detail.order.partner_id,warehouseId:f.warehouse,receivedAt:new Date().toISOString(),currencyCode:detail.order.currency_code,items:[{orderItemId:line.id,itemId:line.item_id,quantity:f.quantity,unitPriceCents:f.price}]},"Prijem robe je evidentiran.");}}>
    <fieldset className="gx-stack" disabled={sender.busy || sender.locked}><FormGrid>
      <Select label="Poslana narudžbenica" required value={f.order} onChange={e=>set({...f,order:e.target.value,line:""})}><option value="">Odaberite</option>{options.orders.filter(o=>["SENT","PARTIALLY_RECEIVED"].includes(o.status)).map(o=><option key={o.id} value={o.id}>{o.id} · {o.status}</option>)}</Select>
      <Select label="Stavka narudžbenice" required value={f.line} onChange={e=>set({...f,line:e.target.value})}><option value="">Odaberite</option>{detail?.items.map(i=><option key={i.id} value={i.id}>{i.description} · primljeno {i.received_quantity} od {i.quantity}</option>)}</Select>
      <Select label="Skladište prijema" required value={f.warehouse} onChange={e=>set({...f,warehouse:e.target.value})}><option value="">Odaberite</option>{options.warehouses.filter(w=>w.is_active).map(w=><option key={w.id} value={w.id}>{w.name} · {w.kind}</option>)}</Select>
      <Input label="Količina prijema" required inputMode="decimal" value={f.quantity} onChange={e=>set({...f,quantity:e.target.value})}/>
      <Input label="Cijena prijema (feninga po jedinici)" required inputMode="numeric" pattern="[0-9]+" value={f.price} onChange={e=>set({...f,price:e.target.value})}/>
    </FormGrid></fieldset><Button type="submit" variant="primary" disabled={sender.busy}>{sender.locked ? "Ponovi prijem" : "Evidentiraj prijem"}</Button>
  </form></FormSection></Card>;
}

export function InvoiceForm({options,onDone}:Props) {
  const [f,set]=useState({receipt:"",number:"",date:new Date().toISOString().slice(0,10),due:"",quantity:"",amount:"",project:""});
  const sender=usePurchasePost(onDone);
  const receipt=options.receipts.find(r=>r.item_id===f.receipt);
  return <Card><FormSection title="Račun dobavljača"><p>Prilikom neslaganja s prijemom prikazuje se PURCHASE_INVOICE_MISMATCH.</p><Failure error={sender.error}/><form onSubmit={e=>{e.preventDefault();if(!receipt)return;void sender.post("/api/purchase-invoices",{partnerId:receipt.partner_id,orderId:receipt.order_id,projectId:f.project || null,invoiceNumber:f.number,invoiceDate:f.date,dueDate:f.due || null,amountCents:f.amount,currencyCode:receipt.currency_code,items:[{receiptItemId:receipt.item_id,quantity:f.quantity,amountCents:f.amount}]},"Račun je evidentiran.");}}>
    <fieldset className="gx-stack" disabled={sender.busy || sender.locked}><FormGrid>
      <Select label="Stavka prijema za račun" required value={f.receipt} onChange={e=>set({...f,receipt:e.target.value})}><option value="">Odaberite</option>{options.receipts.map(r=><option key={r.item_id} value={r.item_id}>{r.item_name} · {r.quantity} {r.unit} · {r.id}</option>)}</Select>
      <Input label="Broj računa" required maxLength={120} value={f.number} onChange={e=>set({...f,number:e.target.value})}/>
      <Input label="Datum računa" required type="date" value={f.date} onChange={e=>set({...f,date:e.target.value})}/>
      <Input label="Rok plaćanja" type="date" value={f.due} onChange={e=>set({...f,due:e.target.value})}/>
      <Input label="Količina na računu" required inputMode="decimal" value={f.quantity} onChange={e=>set({...f,quantity:e.target.value})}/>
      <Input label="Iznos računa (feninga)" required inputMode="numeric" pattern="[0-9]+" value={f.amount} onChange={e=>set({...f,amount:e.target.value})}/>
      <Select label="Projekat računa" value={f.project} onChange={e=>set({...f,project:e.target.value})}><option value="">Opći trošak</option>{options.projects.map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select>
    </FormGrid></fieldset><Button type="submit" variant="primary" disabled={sender.busy}>{sender.locked ? "Ponovi račun" : "Evidentiraj račun"}</Button>
  </form></FormSection></Card>;
}

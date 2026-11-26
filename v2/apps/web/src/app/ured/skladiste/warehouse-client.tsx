"use client";
import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import type { WarehousesResponse, StockBalanceResponse, StockCountsResponse, StockCountDetailResponse } from "@gradix/contracts";
import { apiCall, jsonBody } from "@/api-client";
import { Alert, Button, Card, DataTable, FormGrid, FormSection, Input, Select, Stack } from "@/components/ui";

type Warehouse = z.infer<typeof WarehousesResponse>["warehouses"][number];
type Balance = z.infer<typeof StockBalanceResponse>["balances"][number];
type Count = z.infer<typeof StockCountsResponse>["counts"][number];
const today=()=>new Date().toISOString().slice(0,10);
export function WarehouseClient({canManage,canPurchase}:{canManage:boolean;canPurchase:boolean}) {
  const [warehouses,setWarehouses]=useState<Warehouse[]>([]);
  const [balances,setBalances]=useState<Balance[]>([]);
  const [counts,setCounts]=useState<Count[]>([]);
  const [detail,setDetail]=useState<z.infer<typeof StockCountDetailResponse>|null>(null);
  const [warehouse,setWarehouse]=useState("");
  const [notice,setNotice]=useState<{tone:"success"|"error";text:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const [transfer,setTransfer]=useState({from:"",to:"",item:"",quantity:"",date:today()});
  const [count,setCount]=useState({warehouse:"",item:"",quantity:"",reason:""});
  const load=useCallback(async()=>{
    const [w,b,c]=await Promise.all([
      apiCall<{warehouses:Warehouse[]}>("/api/warehouses"),apiCall<{balances:Balance[]}>("/api/stock/balance"),
      canManage ? apiCall<{counts:Count[]}>("/api/stock-counts") : Promise.resolve(null),
    ]);
    if(w.ok) setWarehouses(w.data.warehouses); else setNotice({tone:"error",text:w.message});
    if(b.ok) setBalances(b.data.balances); else setNotice({tone:"error",text:b.message});
    if(c?.ok) setCounts(c.data.counts); else if(c && !c.ok) setNotice({tone:"error",text:c.message});
  },[canManage]);
  useEffect(()=>{void load();},[load]);
  async function sendTransfer(event:React.FormEvent) {
    event.preventDefault(); setBusy(true); setNotice(null);
    const result=await apiCall<{belowMinimum:boolean}>("/api/stock-transfers",jsonBody({fromWarehouseId:transfer.from,toWarehouseId:transfer.to,itemId:transfer.item,quantity:transfer.quantity,occurredOn:transfer.date}));
    setBusy(false);
    if(!result.ok) {setNotice({tone:"error",text:`${result.message} Ako je veza prekinuta, provjerite stanje prije ponavljanja transfera.`}); return;}
    setNotice({tone:"success",text:result.data.belowMinimum ? "Transfer je izvršen; izvor je ispod minimuma." : "Transfer je izvršen."});
    setTransfer({...transfer,quantity:""}); await load();
  }
  async function createCount(event:React.FormEvent) {
    event.preventDefault(); setBusy(true); setNotice(null);
    const result=await apiCall<{id:string}>("/api/stock-counts",jsonBody({warehouseId:count.warehouse,reason:count.reason.trim() || null,items:[{itemId:count.item,countedQuantity:count.quantity}]}));
    setBusy(false);
    if(!result.ok) {setNotice({tone:"error",text:result.message}); return;}
    setNotice({tone:"success",text:"Nacrt popisa je sačuvan. Primijenite ga nakon provjere."}); setCount({...count,quantity:""}); await load();
  }
  async function showCount(row:Count) {
    setBusy(true); const result=await apiCall<z.infer<typeof StockCountDetailResponse>>(`/api/stock-counts/${encodeURIComponent(row.id)}`); setBusy(false);
    if (!result.ok) {setNotice({tone:"error",text:result.message}); return;}
    setDetail(result.data);
  }
  async function applyCount(row:Count) {
    setBusy(true); setNotice(null);
    const result=await apiCall(`/api/stock-counts/${encodeURIComponent(row.id)}/apply`,jsonBody({reason:row.reason})); setBusy(false);
    if(!result.ok) {setNotice({tone:"error",text:result.message});return;}
    setNotice({tone:"success",text:"Popis je primijenjen kao kretnja razlike."}); setDetail(null); await load();
  }
  const active=warehouses.filter(w=>w.is_active);
  const options=(id:string)=>balances.filter(x=>x.warehouse_id===id);
  const shown=warehouse ? options(warehouse) : balances;
  return <Stack>
    {notice ? <Alert tone={notice.tone} role={notice.tone==="error" ? "alert":"status"}>{notice.text}</Alert>:null}
    <Select label="Skladište" value={warehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">Sva skladišta</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name} · {w.kind}{w.is_active ? "" : " · neaktivno"}</option>)}</Select>
    <p className="gx-page-sub">Prikaz i izbor artikala u obrascima ograničeni su na prvih 1000 kombinacija skladišta i artikala.</p>
    <DataTable caption="Zalihe po skladištu" rows={shown} rowKey={r=>`${r.warehouse_id}:${r.item_id}`} emptyText="Nema zaliha za prikaz." columns={[
      {key:"warehouse",header:"Skladište",cell:r=>r.warehouse_name}, {key:"item",header:"Artikal",cell:r=>`${r.code} · ${r.name}`},
      {key:"balance",header:"Stanje",cell:r=>`${r.on_hand} ${r.unit}`}, {key:"min",header:"Minimum",cell:r=>`${r.min_quantity} ${r.unit}`},
      {key:"warning",header:"Upozorenje",cell:r=>r.below_minimum ? "Ispod minimuma" : "—"},
      {key:"proposal",header:"Nabavka",cell:r=>r.below_minimum && canPurchase ? "Prijedlog nabavke još nije dostupan" : "—"},
    ]} />
    {canManage ? <>
      <Card><FormSection title="Transfer između skladišta"><form onSubmit={sendTransfer}><FormGrid>
        <Select label="Iz skladišta" required value={transfer.from} onChange={e=>setTransfer({...transfer,from:e.target.value,item:""})}><option value="">Odaberite</option>{active.map(w=><option key={w.id} value={w.id}>{w.name} · {w.kind}</option>)}</Select>
        <Select label="U skladište" required value={transfer.to} onChange={e=>setTransfer({...transfer,to:e.target.value})}><option value="">Odaberite</option>{active.filter(w=>w.id!==transfer.from).map(w=><option key={w.id} value={w.id}>{w.name} · {w.kind}</option>)}</Select>
        <Select label="Artikal za transfer" required value={transfer.item} onChange={e=>setTransfer({...transfer,item:e.target.value})}><option value="">Odaberite</option>{options(transfer.from).map(b=><option key={b.item_id} value={b.item_id}>{b.name} · {b.on_hand} {b.unit}</option>)}</Select>
        <Input label="Količina za transfer" required inputMode="decimal" value={transfer.quantity} onChange={e=>setTransfer({...transfer,quantity:e.target.value})} />
        <Input label="Datum transfera" type="date" required value={transfer.date} onChange={e=>setTransfer({...transfer,date:e.target.value})} />
      </FormGrid><Button type="submit" variant="primary" disabled={busy}>Izvrši transfer</Button></form></FormSection></Card>
      <Card><FormSection title="Popis / inventura"><p>Unesite izbrojano stanje; primjena će dodati samo razliku.</p><form onSubmit={createCount}><FormGrid>
        <Select label="Skladište popisa" required value={count.warehouse} onChange={e=>setCount({...count,warehouse:e.target.value,item:""})}><option value="">Odaberite</option>{active.map(w=><option key={w.id} value={w.id}>{w.name} · {w.kind}</option>)}</Select>
        <Select label="Artikal za popis" required value={count.item} onChange={e=>setCount({...count,item:e.target.value})}><option value="">Odaberite</option>{options(count.warehouse).map(b=><option key={b.item_id} value={b.item_id}>{b.name} · stanje {b.on_hand} {b.unit}</option>)}</Select>
        <Input label="Izbrojana količina" required inputMode="decimal" value={count.quantity} onChange={e=>setCount({...count,quantity:e.target.value})} />
        <Input label="Razlog razlike (opciono)" value={count.reason} onChange={e=>setCount({...count,reason:e.target.value})} hint="Obavezan kod razlike iznad tolerancije ili nepoznate cijene." />
      </FormGrid><Button type="submit" variant="primary" disabled={busy}>Sačuvaj nacrt popisa</Button></form></FormSection></Card>
      <DataTable caption="Popisi" rows={counts} rowKey={r=>r.id} emptyText="Nema popisa." columns={[
        {key:"warehouse",header:"Skladište",cell:r=>warehouses.find(w=>w.id===r.warehouse_id)?.name ?? r.warehouse_id},
        {key:"status",header:"Status",cell:r=>r.status==="DRAFT" ? "Nacrt" : "Primijenjen"}, {key:"reason",header:"Razlog",cell:r=>r.reason ?? "—"},
        {key:"action",header:"Radnja",cell:r=><Button disabled={busy} onClick={()=>void showCount(r)}>Pregledaj popis</Button>},
      ]} />
      {detail ? <Card><FormSection title="Stavke popisa"><p>Razlike se obračunavaju prema stanju u trenutku primjene.</p>
        <DataTable caption="Stavke odabranog popisa" rows={detail.items} rowKey={r=>r.item_id} columns={[
          {key:"item",header:"Artikal",cell:r=>balances.find(b=>b.item_id===r.item_id)?.name ?? r.item_id},
          {key:"counted",header:"Izbrojano",cell:r=>r.counted_quantity}, {key:"system",header:"Stanje pri primjeni",cell:r=>r.system_quantity ?? "—"},
          {key:"difference",header:"Razlika",cell:r=>r.difference ?? "—"},
        ]} />
        {detail.count.status==="DRAFT" ? <Button disabled={busy} onClick={()=>void applyCount(detail.count)}>Primijeni ovaj popis</Button> : null}
      </FormSection></Card> : null}
    </>:null}
  </Stack>;
}

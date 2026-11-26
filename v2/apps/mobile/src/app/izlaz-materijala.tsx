/** Terenski izlaz se prvo sprema u account-partitioned SQLite; stanje potvrđuje server. */
import { useCallback,useEffect,useRef,useState } from "react";
import { randomUUID } from "expo-crypto";
import { fetchMaterialCatalog } from "../api/client";
import { openDb } from "../db/sqlite";
import { getActiveLocalAccount } from "../db/r4-outbox";
import { queueMaterialIssue,readMaterialCatalog,readMaterialIssues,writeMaterialCatalog,type MaterialCatalog,type MaterialRow } from "../db/material-issue";
import { runSqliteR4Sync } from "../sync/r4-sqlite";
import { Button,CardView,ListItem,Screen,Text,TextField } from "../ui";

export default function MaterialIssueScreen() {
  const [catalog,setCatalog]=useState<MaterialCatalog|null>(null);const [fetchedAt,setFetchedAt]=useState<string|null>(null);
  const [project,setProject]=useState("");const [warehouse,setWarehouse]=useState("");const [phase,setPhase]=useState("");const [item,setItem]=useState("");const [quantity,setQuantity]=useState("");
  const [rows,setRows]=useState<MaterialRow[]>([]);const [message,setMessage]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const inFlight=useRef(false);
  const load=useCallback(async()=>{try{const db=await openDb();const account=await getActiveLocalAccount(db);if(!account)throw new Error("Nema aktivnog naloga na uređaju.");
    const saved=await readMaterialCatalog(db,account);setCatalog(saved?.catalog ?? null);setFetchedAt(saved?.fetchedAt ?? null);setRows(await readMaterialIssues(db,account));setError(null);
  }catch(e){setError(e instanceof Error ? e.message : "Lokalni podaci nisu dostupni.");}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  async function refresh() {
    if(inFlight.current)return;inFlight.current=true;setBusy(true);
    try{const db=await openDb();const account=await getActiveLocalAccount(db);if(!account)throw new Error("Nema aktivnog naloga.");
      const next=await fetchMaterialCatalog(account);await writeMaterialCatalog(db,account,next);await load();setProject("");setWarehouse("");setPhase("");setItem("");setMessage("Podaci su osvježeni i sačuvani za offline rad.");
    }catch{setMessage("Osvježavanje nije uspjelo. Dostupan je posljednji sačuvani presjek, ako postoji.");}
    finally{inFlight.current=false;setBusy(false);}
  }
  async function save(){
    if(inFlight.current)return;
    const site=catalog?.warehouses.find(w=>w.id===warehouse && w.project_id===project);
    const selectedItem=catalog?.items.find(i=>i.id===item);
    const selectedProject=catalog?.projects.some(p=>p.id===project);
    if(!site || !selectedItem || !selectedProject || (phase && !catalog?.phases[project]?.some(p=>p.id===phase))) {setMessage("Izaberite projekat, njegovo gradilišno skladište i artikal iz sačuvanog presjeka.");return;}
    inFlight.current=true;setBusy(true);
    try{const db=await openDb();const account=await getActiveLocalAccount(db);if(!account)throw new Error("Nema aktivnog naloga.");
      await queueMaterialIssue(db,account,{clientGeneratedId:randomUUID(),warehouseId:warehouse,projectId:project,phaseId:phase || null,issuedAt:new Date().toISOString(),items:[{itemId:item,quantity:quantity.trim()}]});
      setQuantity("");setMessage("Izlaz je sačuvan na telefonu i čeka slanje. Zaliha još nije promijenjena na serveru.");await load();
    }catch(e){setMessage(e instanceof Error ? e.message : "Izlaz nije sačuvan.");}
    finally{inFlight.current=false;setBusy(false);}
  }
  async function send(){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);
    try{const db=await openDb();const account=await getActiveLocalAccount(db);if(!account)throw new Error("Nema aktivnog naloga.");
      const result=await runSqliteR4Sync(db,account);await load();setMessage(result.error || result.retry ? "Slanje nije završeno. Neposlani izlazi ostaju na telefonu; provjerite ishod ispod." : "Slanje završeno. Provjerite status svakog izlaza ispod.");
    }catch{setMessage("Slanje nije uspjelo. Izlazi ostaju sačuvani na telefonu.");}
    finally{inFlight.current=false;setBusy(false);}
  }
  return <Screen title="Izlaz materijala" subtitle="Pripremi lokalno, pošalji kada ima veze. Server provjerava količinu i cijenu." loading={loading} error={error} empty={null}>
    <CardView><Text>Podaci za izbor: {fetchedAt ?? "još nisu preuzeti"}. Prije prvog offline unosa osvježi ih dok imaš vezu.</Text>
      <Button label="Osvježi projekte i artikle" variant="secondary" busy={busy} onPress={()=>void refresh()}/>
      <Text variant="label">Projekat</Text>
      {catalog?.projects.map(p=><Button key={p.id} label={`${project===p.id ? "✓ " : ""}${p.code} · ${p.name}`} variant={project===p.id ? "primary":"secondary"} disabled={busy} onPress={()=>{setProject(p.id);setWarehouse("");setPhase("");}}/>)}
      {project ? <><Text variant="label">Gradilišno skladište</Text>{catalog?.warehouses.filter(w=>w.project_id===project).map(w=><Button key={w.id} label={`${warehouse===w.id ? "✓ " : ""}${w.name}`} variant={warehouse===w.id ? "primary":"secondary"} disabled={busy} onPress={()=>setWarehouse(w.id)}/>)}
        <Text variant="label">Faza (opciono)</Text><Button label={`${!phase ? "✓ " : ""}Bez faze`} variant={!phase ? "primary":"secondary"} disabled={busy} onPress={()=>setPhase("")}/>
        {catalog?.phases[project]?.map(p=><Button key={p.id} label={`${phase===p.id ? "✓ " : ""}${p.name}`} variant={phase===p.id ? "primary":"secondary"} disabled={busy} onPress={()=>setPhase(p.id)}/>)}</>:null}
      <Text variant="label">Artikal</Text>{catalog?.items.map(i=><Button key={i.id} label={`${item===i.id ? "✓ " : ""}${i.code} · ${i.name} (${i.unit})`} variant={item===i.id ? "primary":"secondary"} disabled={busy} onPress={()=>setItem(i.id)}/>)}
      <TextField label="Količina izlaza" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" editable={!busy}/>
      <Button label="Sačuvaj izlaz na telefon" busy={busy} onPress={()=>void save()}/><Button label="Pošalji sada" variant="secondary" busy={busy} onPress={()=>void send()}/>
    </CardView>
    {message ? <Text>{message}</Text>:null}
    <Text variant="label">Izlazi na ovom uređaju</Text>
    {rows.map(r=><ListItem key={r.localId} title={r.status==="sent" ? "Poslano" : r.status==="rejected" ? "Odbijeno — provjerite" : r.status==="failed" ? "Slanje nije uspjelo" : "Čeka slanje"} meta={`${r.payload.items[0]?.quantity ?? ""} · ${r.error ?? r.createdAt}`}/>)}
  </Screen>;
}

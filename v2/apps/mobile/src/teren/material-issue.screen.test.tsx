import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({saved:[] as unknown[],refresh:0}));
vi.mock("expo-crypto",()=>({randomUUID:()=>"11111111-1111-4111-8111-111111111111"}));
vi.mock("expo-router",async()=>{const React=await import("react");const {View}=await import("react-native");return {Link:({children}:{children?:React.ReactNode})=>React.createElement(View,null,children),useRouter:()=>({replace:()=>undefined})};});
vi.mock("expo-secure-store",()=>({getItemAsync:async()=>null,setItemAsync:async()=>undefined,deleteItemAsync:async()=>undefined}));
vi.mock("../api/session-lifecycle",()=>({getLogoutSummary:async()=>({pendingCount:0,legacyR0Count:0}),logoutMobile:async()=>({serverRevoked:true})}));
vi.mock("../api/client",()=>({fetchMaterialCatalog:async()=>{state.refresh++;throw new Error("offline");}}));
vi.mock("../db/sqlite",()=>({openDb:async()=>({})}));
vi.mock("../db/r4-outbox",()=>({getActiveLocalAccount:async()=>({companyId:"c",userId:"u"})}));
vi.mock("../db/material-issue",()=>({
  readMaterialCatalog:async()=>({fetchedAt:"2026-11-01",catalog:{projects:[{id:"p",code:"P",name:"Gradilište"}],warehouses:[{id:"w",name:"Priručno",project_id:"p"}],items:[{id:"i",code:"I",name:"Cement",unit:"kg"}],phases:{p:[{id:"f",name:"Temelji"}]}}}),
  readMaterialIssues:async()=>[],writeMaterialCatalog:async()=>undefined,
  queueMaterialIssue:async(_db:unknown,_account:unknown,payload:unknown)=>{state.saved.push(payload);},
}));
vi.mock("../sync/r4-sqlite",()=>({runSqliteR4Sync:async()=>({retry:1,error:"NETWORK_ERROR"})}));
import MaterialIssueScreen from "../app/izlaz-materijala";
beforeEach(()=>{state.saved=[];state.refresh=0;});afterEach(cleanup);
describe("Terenski izlaz materijala",()=>{
  it("offline iz presjeka sprema projekat, SITE, fazu i količinu bez mrežnog poziva",async()=>{
    render(<MaterialIssueScreen/>);
    expect(getComputedStyle(await screen.findByRole("button",{name:"Osvježi projekte i artikle"})).minHeight).toBe("56px");
    fireEvent.click(await screen.findByText("P · Gradilište"));fireEvent.click(screen.getByText("Priručno"));fireEvent.click(screen.getByText("Temelji"));fireEvent.click(screen.getByText("I · Cement (kg)"));
    fireEvent.change(screen.getByLabelText("Količina izlaza"),{target:{value:"1.250"}});fireEvent.click(screen.getByText("Sačuvaj izlaz na telefon"));
    await screen.findByText(/Izlaz je sačuvan na telefonu/);
    expect(state.saved).toHaveLength(1);expect(state.saved[0]).toMatchObject({clientGeneratedId:"11111111-1111-4111-8111-111111111111",warehouseId:"w",projectId:"p",phaseId:"f",items:[{itemId:"i",quantity:"1.250"}]});expect(state.refresh).toBe(0);
    fireEvent.click(screen.getByText("Pošalji sada"));await screen.findByText(/Slanje nije završeno/);
  });
  it("ne sprema bez izbora projekta i skladišta",async()=>{
    render(<MaterialIssueScreen/>);fireEvent.click(await screen.findByText("Sačuvaj izlaz na telefon"));await screen.findByText(/Izaberite projekat/);expect(state.saved).toHaveLength(0);
  });
});

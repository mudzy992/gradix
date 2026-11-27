// @vitest-environment jsdom
import { render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,describe,expect,it,vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { SubcontractClient } from "./subcontract-client";
const contract={id:"c",project_id:"p",partner_id:"ptr",code:"U-1",title:"Radovi",scope:null,contract_value_cents:"10000",amendment_cents:"1000",currency_code:"BAM",retention_pct:"10.00",warranty_pct:"5.00",valid_from:null,valid_to:null,status:"ACTIVE",document_attachment_id:null,created_at:"2026-01-01"};
const statement={id:"s",contract_id:"c",phase_id:null,period_from:"2026-01-01",period_to:"2026-01-31",statement_no:"S-1",status:"SUBMITTED",gross_cents:"12000",retention_pct:"10.00",warranty_pct:"5.00",retention_cents:"1200",warranty_cents:"600",net_cents:"10200",currency_code:"BAM",exceeded_at_approval:false,created_at:"2026-01-01"};
const partners=[{id:"ptr",code:"P",name:"Izvođač"}];
function mockApi(){
  const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
    const data=init?.method ? {id:"new",warnings:url.endsWith("/approve") ? ["SUBCONTRACTOR_CONTRACT_EXCEEDED"] : []}
      : url==="/api/subcontractor-contracts" ? {contracts:[contract]} : url==="/api/subcontractor-statements" ? {statements:[statement]}
      : url==="/api/projects" ? {projects:[{id:"p",code:"P",name:"Projekat"}]} : url.endsWith("/amend") ? {amendments:[{id:"a",contract_id:"c",value_amendment_cents:"1000",reason:"Dodatni radovi",created_at:"2026-01-01"}]} : {phases:[{id:"f",name:"Faza"}]};
    return {ok:true,status:200,json:async()=>({success:true,data}),headers:{get:()=>null}};
  });vi.stubGlobal("fetch",fetch);return fetch;
}
afterEach(()=>vi.unstubAllGlobals());
describe("Podizvođači",()=>{
  it("prikazuje bruto, odbitke, neto i upozorenje bez blokade te prolazi axe",async()=>{
    const fetch=mockApi();const user=userEvent.setup();const {container}=render(<SubcontractClient canManage partners={partners}/>);
    await screen.findByRole("table",{name:"Ugovori podizvođača"});
    await user.click(screen.getByRole("tab",{name:"Situacije"}));
    const table=screen.getByRole("table",{name:"Situacije podizvođača"});
    expect(table).toHaveTextContent("120.00 BAM");expect(table).toHaveTextContent("10.00% · 12.00 BAM");expect(table).toHaveTextContent("5.00% · 6.00 BAM");expect(table).toHaveTextContent("102.00 BAM");expect(table).toHaveTextContent("Prekoračenje ugovora");
    await expectNoSeriousA11yViolations(container);
    await user.click(screen.getByRole("tab",{name:"Aneksi"}));
    await user.selectOptions(screen.getByLabelText("Pregled aneksa za ugovor"),"c");
    expect(await screen.findByText("Dodatni radovi")).toBeInTheDocument();
    await user.click(screen.getByRole("tab",{name:"Situacije"}));
    await user.click(screen.getByRole("button",{name:"Odobri situaciju"}));
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith("/api/subcontractor-statements/s/approve",expect.objectContaining({method:"POST"})));
    expect(await screen.findByText(/Situacija je odobrena. Upozorenje/)).toBeInTheDocument();
  });
  it("kreira aneks i situaciju sa stabilnim UUID-om",async()=>{
    const fetch=mockApi();const user=userEvent.setup();render(<SubcontractClient canManage partners={partners}/>);
    await screen.findByRole("table",{name:"Ugovori podizvođača"});
    await user.click(screen.getByRole("tab",{name:"Aneksi"}));await user.click(screen.getByRole("button",{name:"+ Novi aneks"}));
    await user.selectOptions(screen.getByLabelText("Ugovor za aneks"),"c");await user.type(screen.getByLabelText("Povećanje vrijednosti (feninga)"),"5000");await user.type(screen.getByLabelText("Razlog aneksa"),"Dodatni radovi");
    await user.click(screen.getByRole("button",{name:"Sačuvaj aneks"}));await screen.findByText("Aneks je sačuvan.");
    const amend=fetch.mock.calls.find(([u,i])=>u==="/api/subcontractor-contracts/c/amend" && i?.method==="POST");
    expect(JSON.parse(amend![1]!.body as string)).toMatchObject({valueAmendmentCents:"5000",reason:"Dodatni radovi",clientGeneratedId:expect.stringMatching(/^[0-9a-f-]{36}$/)});
    await user.click(screen.getByRole("tab",{name:"Situacije"}));await user.click(screen.getByRole("button",{name:"+ Nova situacija"}));
    await user.selectOptions(screen.getByLabelText("Ugovor za situaciju"),"c");await screen.findByRole("option",{name:"Faza"});await user.selectOptions(screen.getByLabelText("Faza situacije"),"f");
    await user.type(screen.getByLabelText("Broj situacije"),"S-2");await user.type(screen.getByLabelText("Period od"),"2026-01-01");await user.type(screen.getByLabelText("Period do"),"2026-01-31");
    await user.type(screen.getByLabelText("Opis radova"),"Radovi");await user.type(screen.getByLabelText("Bruto iznos situacije (feninga)"),"1000");
    await user.click(screen.getByRole("button",{name:"Predaj situaciju"}));await screen.findByText("Situacija je predana.");
    const saved=fetch.mock.calls.find(([u,i])=>u==="/api/subcontractor-statements" && i?.method==="POST");expect(JSON.parse(saved![1]!.body as string)).toMatchObject({contractId:"c",phaseId:"f",items:[{description:"Radovi",amountCents:"1000"}]});
  });
  it("bez prava upravljanja ne prikazuje obrasce i odobrenje",async()=>{
    mockApi();render(<SubcontractClient canManage={false} partners={[]}/>);await screen.findByRole("table",{name:"Ugovori podizvođača"});
    expect(screen.queryByRole("button",{name:"Odobri situaciju"})).not.toBeInTheDocument();expect(screen.queryByLabelText("Podizvođač")).not.toBeInTheDocument();
  });
});

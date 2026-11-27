// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { PurchaseClient } from "./purchase-client";

function mockApi() {
  const responses:Record<string,unknown>={
    "/api/purchase-requests":{requests:[{id:"req",project_id:"p",phase_id:null,requested_by_worker_id:null,needed_by:null,justification:"Beton",status:"DRAFT",total_estimated_cents:"200",currency_code:"BAM",approval_threshold_cents:null,created_by:"u",created_at:"2026-01-01"}]},
    "/api/purchase-orders":{orders:[]}, "/api/goods-receipts":{receipts:[]},
    "/api/purchase-invoices":{invoices:[{id:"inv",partner_id:"partner",invoice_number:"R-1",invoice_date:"2026-01-01",due_date:null,amount_cents:"101",currency_code:"BAM",order_id:null,project_id:"p",phase_id:null,attachment_id:null,status:"PENDING",created_at:"2026-01-01",warnings:["PURCHASE_INVOICE_MISMATCH"]}]},
    "/api/material-issues":{issues:[{id:"issue",warehouse_id:"w",warehouse_name:"Centralno",project_id:"p",phase_id:null,issued_at:"2026-01-01",currency_code:"BAM",note:null,below_minimum:true,amount_cents:"123"}]},
    "/api/stock-items":{items:[{id:"i",code:"C",name:"Cement",unit:"kg",is_active:true}]},
    "/api/warehouses":{warehouses:[{id:"w",code:"C",name:"Centralno",kind:"CENTRAL",project_id:null,address:null,is_active:true}]},
    "/api/partners":{partners:[{id:"partner",name:"Dobavljač",code:"D",kind:"VENDOR",active:true,note:null}]},
    "/api/projects":{projects:[{id:"p",code:"P",name:"Projekat"}]},
  };
  const fetch=vi.fn(async (url:string,init?:RequestInit)=>({ok:true,status:200,json:async()=>({success:true,data:init?.method ? {id:"new",approvalRequired:true} : responses[url]}),headers:{get:()=>null}}));
  vi.stubGlobal("fetch",fetch);return fetch;
}
afterEach(()=>vi.unstubAllGlobals());
describe("Nabavka",()=>{
  it("prikazuje izlaze, prag i upozorenje o neslaganju te prolazi axe",async()=>{
    mockApi();const user=userEvent.setup();const {container}=render(<PurchaseClient canManage initialItem="i" initialWarehouse="w"/>);
    await waitFor(()=>expect(screen.getByLabelText("Artikal zahtjeva")).toHaveValue("i"));
    await expectNoSeriousA11yViolations(container);
    await user.click(screen.getByRole("button",{name:"Zatvori"}));
    expect(screen.getByRole("table",{name:"Zahtjevi nabavke"})).toHaveTextContent("Određuje se pri predaji");
    await user.click(screen.getByRole("tab",{name:"Računi"}));
    expect(screen.getByText(/PURCHASE_INVOICE_MISMATCH: račun se ne slaže/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab",{name:"Izlazi"}));
    expect(screen.getByRole("table",{name:"Izlazi materijala"})).toHaveTextContent("Centralno");
    await expectNoSeriousA11yViolations(container);
  });
  it("kreira nacrt s odabranim artiklom i UUID-om te predaje postojeći zahtjev",async()=>{
    const fetch=mockApi(); const user=userEvent.setup();
    render(<PurchaseClient canManage initialItem="i" initialWarehouse="w"/>);
    await waitFor(()=>expect(screen.getByLabelText("Artikal zahtjeva")).toHaveValue("i"));
    await user.selectOptions(screen.getByLabelText("Projekat zahtjeva"),"p");
    await user.type(screen.getByLabelText("Količina zahtjeva"),"2.5");
    await user.type(screen.getByLabelText("Procjena po jedinici (feninga)"),"300");
    await user.type(screen.getByLabelText("Obrazloženje"),"Materijal");
    await user.click(screen.getByRole("button",{name:"Sačuvaj nacrt zahtjeva"}));
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith("/api/purchase-requests",expect.objectContaining({method:"POST"})));
    const call=fetch.mock.calls.find(([url,init])=>url==="/api/purchase-requests" && init?.method==="POST");
    const body=JSON.parse(call![1]!.body as string);
    expect(body.clientGeneratedId).toMatch(/^[0-9a-f-]{36}$/);expect(body.items[0]).toMatchObject({itemId:"i",quantity:"2.5",estimatedUnitPriceCents:"300"});
    await screen.findByText("Nacrt zahtjeva je sačuvan.");
    await user.click(screen.getByRole("button",{name:"Predaj zahtjev"}));
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith("/api/purchase-requests/req/submit",expect.objectContaining({method:"POST"})));
    expect(await screen.findByText(/potrebna je odluka vlasnika/)).toBeInTheDocument();
  });
  it("nakon nepoznatog ishoda zatvaranje dijaloga čuva isti UUID i payload za retry",async()=>{
    const base=mockApi();let posts=0;const bodies:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
      if(url === "/api/purchase-requests" && init?.method === "POST"){
        posts++;bodies.push(init.body as string);
        if(posts===1) throw new Error("connection lost");
      }
      return base(url,init);
    }));
    const user=userEvent.setup();render(<PurchaseClient canManage initialItem="i" initialWarehouse="w"/>);
    await waitFor(()=>expect(screen.getByLabelText("Artikal zahtjeva")).toHaveValue("i"));
    await user.selectOptions(screen.getByLabelText("Projekat zahtjeva"),"p");
    await user.type(screen.getByLabelText("Količina zahtjeva"),"2");
    await user.type(screen.getByLabelText("Procjena po jedinici (feninga)"),"300");
    await user.type(screen.getByLabelText("Obrazloženje"),"Materijal");
    await user.click(screen.getByRole("button",{name:"Sačuvaj nacrt zahtjeva"}));
    expect(await screen.findByText(/Ponovite s istim podacima/)).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Zatvori"}));
    await user.click(screen.getByRole("tab",{name:"Narudžbenice"}));
    await user.click(screen.getByRole("tab",{name:"Zahtjevi"}));
    await user.click(screen.getByRole("button",{name:"+ Novi zahtjev"}));
    await user.click(screen.getByRole("button",{name:"Ponovi zahtjev"}));
    await waitFor(()=>expect(posts).toBe(2));
    expect(bodies[1]).toBe(bodies[0]);
  });
  it("ne nudi unos korisniku bez purchase.manage",async()=>{
    mockApi();render(<PurchaseClient canManage={false} initialItem="" initialWarehouse=""/>);
    await screen.findByRole("table", {name:"Zahtjevi nabavke"});
    expect(screen.queryByRole("button",{name:"Sačuvaj nacrt zahtjeva"})).not.toBeInTheDocument();
  });
});

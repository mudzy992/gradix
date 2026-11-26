// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualCostForm } from "./manual-cost-form";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const categories=[{id:"cc",code:"C",name:"Materijal",sort_order:1,default_for_source_type:null,is_active:true,usage_count:0}];
afterEach(()=>vi.unstubAllGlobals());
describe("Ručni trošak",()=>{
  it("čuva isti UUID i identičan sadržaj kod ponavljanja, a ne knjiži PENDING",async()=>{
    let calls=0; const saved=vi.fn();
    const fetch=vi.fn(async (_url:string,_init:RequestInit)=>{
      calls++;
      if(calls===1) throw Error("mreža");
      return {ok:true,json:async()=>({success:true,data:{approvalStatus:"PENDING"}}),headers:{get:()=>null}};
    });
    vi.stubGlobal("fetch",fetch);
    const user=userEvent.setup();
    const {container}=render(<ManualCostForm projectId="p" categories={categories} currency="BAM" onClose={()=>{}} onSaved={saved} />);
    await user.type(screen.getByLabelText("Iznos"),"500.01");
    await expectNoSeriousA11yViolations(container);
    await user.click(screen.getByRole("button",{name:"Pošalji trošak"}));
    await screen.findByRole("button",{name:"Ponovi slanje"});
    expect(screen.getByLabelText("Iznos")).toBeDisabled();
    await user.click(screen.getByRole("button",{name:"Ponovi slanje"}));
    await waitFor(()=>expect(saved).toHaveBeenCalledWith("Zahtjev čeka odobrenje; trošak još nije knjižen."));
    expect(fetch).toHaveBeenCalledTimes(2);
    const first=JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    const second=JSON.parse(fetch.mock.calls[1]![1]!.body as string);
    expect(first).toEqual(second);
    expect(first.clientGeneratedId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("registruje, učitava i potvrđuje prilog prije kreiranja troška",async()=>{
    const saved=vi.fn();
    const fetch=vi.fn(async (url:string,_init:RequestInit)=>({ok:true,headers:{get:()=>null},json:async()=>({success:true,data:url==="/api/attachments" ? {attachment:{id:"att_1"},uploadUrl:"https://storage.example/upload"} : url==="/api/costs/manual" ? {approvalStatus:"APPROVED"} : {attachment:{status:"ready"}}})}));
    vi.stubGlobal("fetch",fetch);
    vi.stubGlobal("crypto",{randomUUID:()=>"123e4567-e89b-42d3-a456-426614174000",subtle:{digest:async()=>new Uint8Array(32).buffer}});
    const file=new File(["%PDF-1.4"],"racun.pdf",{type:"application/pdf"});
    Object.defineProperty(file,"arrayBuffer",{value:async()=>new Uint8Array([37,80,68,70]).buffer});
    const user=userEvent.setup();
    render(<ManualCostForm projectId="p" categories={categories} currency="BAM" onClose={()=>{}} onSaved={saved}/>);
    await user.type(screen.getByLabelText("Iznos"),"12.00");
    await user.upload(screen.getByLabelText("Prilog računa (opciono)"),file);
    await user.click(screen.getByRole("button",{name:"Pošalji trošak"}));
    await waitFor(()=>expect(saved).toHaveBeenCalled());
    expect(fetch.mock.calls.map(([url])=>url)).toEqual(["/api/attachments","https://storage.example/upload","/api/attachments/att_1/confirm","/api/costs/manual"]);
    const posted=JSON.parse(fetch.mock.calls[3]![1]!.body as string);
    expect(posted).toMatchObject({clientGeneratedId:"123e4567-e89b-42d3-a456-426614174000",attachmentId:"att_1",projectId:"p"});
  });

});

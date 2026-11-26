import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
const mock=vi.hoisted(()=>({guard:vi.fn(),list:vi.fn(),audit:vi.fn(),pool:vi.fn()}));
vi.mock("@/server/guard",()=>({guard:mock.guard}));
vi.mock("@/server/db",()=>({getVerifiedPool:mock.pool}));
vi.mock("@/server/obligation-service",()=>({listObligations:mock.list}));
vi.mock("@/server/audit",()=>({writeAudit:mock.audit}));
vi.mock("@gradix/db",()=>({withCompany:async (_p:unknown,_c:unknown,fn:(c:object)=>unknown)=>fn({})}));
const ctx={userId:"u",companyId:"c",roles:["OWNER"],scope:"COMPANY"};
const row={id:"o1",typeId:"t",typeLabel:"Ljekarski",entityKind:"WORKER",workerName:"Amina",machineCode:null,machineName:null,projectCode:null,projectName:null,tenderTitle:null,number:"=broj",issuer:"Dom",expiresAt:"2026-01-01",state:"expired",daysLeft:-1};
describe("izvoz prikazanih obaveza",()=>{
  beforeEach(()=>{vi.clearAllMocks();mock.guard.mockResolvedValue({ok:true,ctx});mock.list.mockResolvedValue({obligations:[row,{...row,id:"o2",workerName:"Drugi",state:"valid"}]});mock.pool.mockResolvedValue({});});
  it("izvozi iste filtere bez priloga, štiti formule i evidentira",async()=>{
    const res=await GET(new NextRequest("http://example.test/api/obligations/list-export?state=expired&entityKind=WORKER&typeId=t&q=Amina"));
    expect(res.status).toBe(200);const csv=await res.text();expect(csv).toContain("'=broj");expect(csv).not.toContain("Drugi");
    expect(mock.list).toHaveBeenCalledWith(expect.anything(),"c",{entityKind:"WORKER"},{includeAttachments:false});
    expect(mock.audit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({metadata:expect.objectContaining({rowCount:1})}));
  });
  it("ne širi opseg i ne otkriva radnike računovođi bez workers.view",async()=>{
    mock.guard.mockResolvedValue({ok:true,ctx:{...ctx,scope:"PROJECTS"}});
    expect((await GET(new NextRequest("http://example.test/api/obligations/list-export"))).status).toBe(403);
    mock.guard.mockResolvedValue({ok:true,ctx:{...ctx,roles:["ACCOUNTANT"]}});
    expect((await GET(new NextRequest("http://example.test/api/obligations/list-export"))).status).toBe(403);
    expect(mock.list).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
const mock=vi.hoisted(()=>({guard:vi.fn(),list:vi.fn(),audit:vi.fn(),pool:vi.fn()}));
vi.mock("@/server/guard",()=>({guard:mock.guard}));
vi.mock("@/server/db",()=>({getVerifiedPool:mock.pool}));
vi.mock("@/server/equipment-service",()=>({listMachines:mock.list}));
vi.mock("@/server/audit",()=>({writeAudit:mock.audit}));
vi.mock("@gradix/db",()=>({withCompany:async (_p:unknown,_c:unknown,fn:(c:object)=>unknown)=>fn({})}));
const ctx={userId:"u",companyId:"c",roles:["OWNER"],scope:"COMPANY"};
const row={isActive:true,categoryId:"cat",code:"=M1",name:"Bager",plate:null,make:null,model:null,categoryName:"Građevina",meterValue:5,meter:"HOURS",ownership:"OWN"};
describe("izvoz mašina",()=>{
  beforeEach(()=>{vi.clearAllMocks();mock.guard.mockResolvedValue({ok:true,ctx});mock.list.mockResolvedValue([row,{...row,name:"Kamion",categoryId:"other"}]);mock.pool.mockResolvedValue({});});
  it("isti filteri, zaštita od formule i audit",async()=>{
    const res=await GET(new NextRequest("http://example.test/api/equipment/export?q=bager&categoryId=cat&inactive=0"));
    expect(res.status).toBe(200);const csv=await res.text();expect(csv).toContain("'=M1");expect(csv).not.toContain("Kamion");
    expect(mock.audit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({metadata:expect.objectContaining({rowCount:1})}));
  });
  it("ne širi projektni opseg i ne izvozi više od 1000",async()=>{
    mock.guard.mockResolvedValue({ok:true,ctx:{...ctx,scope:"PROJECTS"}});
    expect((await GET(new NextRequest("http://example.test/api/equipment/export"))).status).toBe(403);
    mock.guard.mockResolvedValue({ok:true,ctx});mock.list.mockResolvedValue(Array.from({length:1001},()=>row));
    expect((await GET(new NextRequest("http://example.test/api/equipment/export"))).status).toBe(409);
    expect(mock.audit).not.toHaveBeenCalled();
  });
});

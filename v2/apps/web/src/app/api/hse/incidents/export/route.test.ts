import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
const mock=vi.hoisted(()=>({guard:vi.fn(),list:vi.fn(),audit:vi.fn(),pool:vi.fn()}));
vi.mock("@/server/guard",()=>({guard:mock.guard}));
vi.mock("@/server/db",()=>({getVerifiedPool:mock.pool}));
vi.mock("@/server/hse-service",()=>({listIncidents:mock.list}));
vi.mock("@/server/audit",()=>({writeAudit:mock.audit}));
vi.mock("@gradix/db",()=>({withCompany:async (_p:unknown,_c:unknown,fn:(c:object)=>unknown)=>fn({})}));
const ctx={userId:"u",companyId:"c",roles:["OWNER"],scope:"COMPANY"};
const row={kind:"NEAR_MISS",occurredAt:"2026-01-01",severity:"MINOR",status:"REPORTED",projectName:"=Projekat",openActions:0,overdueActions:0,reportableToAuthority:false,reportObligationId:null};
describe("izvoz prikazanih incidenata",()=>{
  beforeEach(()=>{vi.clearAllMocks();mock.guard.mockResolvedValue({ok:true,ctx});mock.list.mockResolvedValue([row,{...row,kind:"ACCIDENT",projectName:"Drugi"}]);mock.pool.mockResolvedValue({});});
  it("prenosi oba filtera, štiti formule i evidentira",async()=>{
    const res=await GET(new NextRequest("http://example.test/api/hse/incidents/export?kind=NEAR_MISS&status=REPORTED"));
    expect(res.status).toBe(200);const csv=await res.text();expect(csv).toContain("'=Projekat");expect(csv).not.toContain("Drugi");
    expect(mock.audit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({metadata:expect.objectContaining({kind:"NEAR_MISS",status:"REPORTED",rowCount:1})}));
  });
  it("ograničen opseg ne dobija izvoz firme",async()=>{
    mock.guard.mockResolvedValue({ok:true,ctx:{...ctx,scope:"PROJECTS"}});
    expect((await GET(new NextRequest("http://example.test/api/hse/incidents/export"))).status).toBe(403);expect(mock.list).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
const mock=vi.hoisted(()=>({guard:vi.fn(),list:vi.fn(),audit:vi.fn(),pool:vi.fn()}));
vi.mock("@/server/guard",()=>({guard:mock.guard}));
vi.mock("@/server/db",()=>({getVerifiedPool:mock.pool}));
vi.mock("@/server/fuel-entry-service",()=>({listFuelEntries:mock.list}));
vi.mock("@/server/audit",()=>({writeAudit:mock.audit}));
vi.mock("@gradix/db",()=>({withCompany:async (_pool:unknown,_company:unknown,fn:(c:object)=>unknown)=>fn({})}));
const ctx={userId:"u",companyId:"c",roles:["OWNER"],scope:"COMPANY"};
const row={machine_id:"m1",machine_code:"=bager",machine_name:"Bager",driver_name:"Vozač",filled_at:"2026-01-01",liters:12,amount:"20.00",currency_code:"BAM",meter_reading:null,project_name:"Projekat"};
describe("izvoz prikazanog goriva",()=>{
  beforeEach(()=>{vi.clearAllMocks();mock.guard.mockResolvedValue({ok:true,ctx});mock.list.mockResolvedValue([row,{...row,machine_id:"m2",machine_name:"Kamion"}]);mock.pool.mockResolvedValue({});});
  it("zadržava filter poslije ograničenja liste, štiti formule i evidentira izvoz",async()=>{
    const response=await GET(new NextRequest("http://example.test/api/fuel-entries/export?machineId=m1"));
    expect(response.status).toBe(200);
    const csv=await response.text();expect(csv).toContain("'=bager");expect(csv).not.toContain("Kamion");
    expect(mock.list).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({companyId:"c"}),{});
    expect(mock.audit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({metadata:expect.objectContaining({machineId:"m1",rowCount:1})}));
  });
  it("ne dozvoljava PROJECTS opseg, čak ni sa pravom izvoza",async()=>{
    mock.guard.mockResolvedValue({ok:true,ctx:{...ctx,scope:"PROJECTS"}});
    const response=await GET(new NextRequest("http://example.test/api/fuel-entries/export"));
    expect(response.status).toBe(403);expect(mock.list).not.toHaveBeenCalled();
  });
});

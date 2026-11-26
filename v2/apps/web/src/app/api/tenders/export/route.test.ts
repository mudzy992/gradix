import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
const mock=vi.hoisted(()=>({guard:vi.fn(),list:vi.fn(),audit:vi.fn(),pool:vi.fn()}));
vi.mock("@/server/guard",()=>({guard:mock.guard}));
vi.mock("@/server/db",()=>({getVerifiedPool:mock.pool}));
vi.mock("@/server/tender-service",()=>({listTenders:mock.list}));
vi.mock("@/server/audit",()=>({writeAudit:mock.audit}));
vi.mock("@gradix/db",()=>({withCompany:async (_p:unknown,_c:unknown,fn:(c:object)=>unknown)=>fn({})}));
const ctx={userId:"u",companyId:"c",roles:["ACCOUNTANT"],scope:"COMPANY"};
const row={id:"1",title:"=Tender",partnerName:"Klijent",deadlineAt:"2026-01-01",daysToDeadline:3,status:"PREPARATION",submittedValueAmount:"10",currencyCode:"BAM",markupPct:"77"};
describe("izvoz prikazanih tendera",()=>{
  beforeEach(()=>{vi.clearAllMocks();mock.guard.mockResolvedValue({ok:true,ctx});mock.list.mockResolvedValue([row,{...row,id:"2",title:"Prošli",daysToDeadline:-1},{...row,id:"3",title:"Završen",status:"WON"}]);mock.pool.mockResolvedValue({});});
  it("prenosi oba filtera, štiti formule i skriva maržu bez dozvole",async()=>{
    const res=await GET(new NextRequest("http://example.test/api/tenders/export?status=PREPARATION&urgent=1"));
    expect(res.status).toBe(200);const csv=await res.text();expect(csv).toContain("'=Tender");
    expect(csv).not.toContain("Prošli");expect(csv).not.toContain("Završen");expect(csv).not.toContain("Marža");expect(csv).not.toContain("77");
    expect(mock.audit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({metadata:expect.objectContaining({status:"PREPARATION",urgent:true,rowCount:1})}));
  });
  it("ograničen opseg ne dobija izvoz firme",async()=>{
    mock.guard.mockResolvedValue({ok:true,ctx:{...ctx,scope:"PROJECTS"}});
    expect((await GET(new NextRequest("http://example.test/api/tenders/export"))).status).toBe(403);
    expect(mock.list).not.toHaveBeenCalled();
  });
});

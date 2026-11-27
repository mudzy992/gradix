import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
const mock=vi.hoisted(()=>({guard:vi.fn(),list:vi.fn(),audit:vi.fn(),pool:vi.fn()}));
vi.mock("@/server/guard",()=>({guard:mock.guard}));
vi.mock("@/server/db",()=>({getVerifiedPool:mock.pool}));
vi.mock("@/server/obligation-service",()=>({listObligations:mock.list}));
vi.mock("@/server/audit",()=>({writeAudit:mock.audit}));
vi.mock("@gradix/db",()=>({withCompany:async (_p:unknown,_c:unknown,fn:(c:object)=>unknown)=>fn({})}));
const ctx={userId:"u",companyId:"c",roles:["PROJECT_MANAGER"],scope:"COMPANY",projectIds:null};
const row={typeLabel:"=tip",entityKind:"WORKER",workerName:"Amina",machineCode:null,projectCode:null,tenderTitle:null,number:null,issuer:null,issuedAt:null,expiresAt:null,reviewAt:null,state:"valid",daysLeft:null,responsibleName:null,note:"privatno"};
describe("postojeći izvoz rokova — zaštita",()=>{
  beforeEach(()=>{vi.clearAllMocks();mock.guard.mockResolvedValue({ok:true,ctx});mock.list.mockResolvedValue({obligations:[row],today:"2026-01-01"});mock.pool.mockResolvedValue({});});
  it("PM bez sensitive prava ne dobija napomenu, a ćelije nisu formule",async()=>{
    const res=await GET(new NextRequest("http://example.test/api/obligations/export?format=csv"));
    expect(res.status).toBe(200);const csv=await res.text();expect(csv).not.toContain("privatno");expect(csv).toContain("'=tip");
  });
  it("PROJECTS scope ne može izvesti cijelu firmu",async()=>{
    mock.guard.mockResolvedValue({ok:true,ctx:{...ctx,scope:"PROJECTS",projectIds:["p"]}});
    expect((await GET(new NextRequest("http://example.test/api/obligations/export"))).status).toBe(200);
    expect(mock.list).toHaveBeenCalledWith(expect.anything(),"c",expect.anything(),expect.objectContaining({scope:"PROJECTS",projectIds:["p"],userId:"u",includeAttachments:false}));
  });
});

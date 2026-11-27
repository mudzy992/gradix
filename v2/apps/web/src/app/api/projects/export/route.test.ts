import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
const mock=vi.hoisted(()=>({guard:vi.fn(),list:vi.fn(),summary:vi.fn(),audit:vi.fn(),pool:vi.fn()}));
vi.mock("@/server/guard",()=>({guard:mock.guard}));
vi.mock("@/server/db",()=>({getVerifiedPool:mock.pool}));
vi.mock("@/server/project-service",()=>({listProjects:mock.list,isProjectStatus:(s:string)=>["ACTIVE","PAUSED"].includes(s)}));
vi.mock("@/app/ured/projekti/projects-summary",()=>({projectFinancialSummaries:mock.summary}));
vi.mock("@/server/audit",()=>({writeAudit:mock.audit}));
vi.mock("@gradix/db",()=>({withCompany:async (_p:unknown,_c:unknown,fn:(c:object)=>unknown)=>fn({})}));
const ctx={userId:"u",companyId:"c",roles:["OWNER"],scope:"PROJECTS",projectIds:["p1"]};
const row={id:"p1",code:"=P1",name:"Most",status:"ACTIVE",sitePlace:"Visoko",workerCount:1,machineCount:2,overdueObligations:0,expiringObligations:0};
describe("izvoz projekata",()=>{
  beforeEach(()=>{vi.clearAllMocks();mock.guard.mockResolvedValue({ok:true,ctx});mock.list.mockResolvedValue([row,{...row,id:"p2",name:"Neaktivni",status:"PAUSED"}]);mock.summary.mockResolvedValue(new Map([["p1",{risky:true,margin:"12",progress_pct:50}],["p2",{risky:false,margin:null,progress_pct:null}]]));mock.pool.mockResolvedValue({});});
  it("koristi scope iz sesije, oba filtera i sigurne CSV ćelije",async()=>{
    const res=await GET(new NextRequest("http://example.test/api/projects/export?status=ACTIVE&risky=1"));
    expect(res.status).toBe(200);const csv=await res.text();expect(csv).toContain("'=P1");expect(csv).not.toContain("Neaktivni");
    expect(mock.list).toHaveBeenCalledWith(expect.anything(),"c",expect.objectContaining({scope:"PROJECTS",projectIds:["p1"]}),{includeInactive:true});
    expect(mock.audit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({metadata:expect.objectContaining({risky:true,rowCount:1})}));
  });
  it("ne dozvoljava prevelik izvoz",async()=>{
    mock.list.mockResolvedValue(Array.from({length:1001},()=>row));
    expect((await GET(new NextRequest("http://example.test/api/projects/export"))).status).toBe(409);
  });
});

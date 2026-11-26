import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { guard } from "@/server/guard";
import { addTaskComment, listTaskComments, listTasks, saveTask } from "@/server/task-service";
import { GET, POST } from "./route";
import { PATCH } from "./[id]/route";
import { GET as COMMENTS, POST as COMMENT } from "./[id]/comments/route";
vi.mock("@/server/guard",()=>({guard:vi.fn()}));
vi.mock("@/server/db",()=>({getVerifiedPool:vi.fn().mockResolvedValue({})}));
vi.mock("@/server/task-service",()=>({listTasks:vi.fn(),saveTask:vi.fn(),listTaskComments:vi.fn(),addTaskComment:vi.fn()}));
const ctx={userId:"u",companyId:"c",roles:["OWNER"],scope:"PROJECTS",projectIds:["my-project"]};
const actor=expect.objectContaining(ctx);
const params={params:Promise.resolve({id:"task"})};
const request=(url:string,body?:object)=>new NextRequest(`http://test${url}`,body ? {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)} : undefined);
describe("task HTTP rute prenose scope iz sesije",()=>{
  beforeEach(()=>{
    vi.mocked(guard).mockResolvedValue({ok:true,ctx:ctx as never});
    vi.mocked(listTasks).mockResolvedValue({tasks:[],counts:{mine_today:0,open:0,overdue:0}});
    vi.mocked(saveTask).mockResolvedValue({id:"task"} as never);
    vi.mocked(listTaskComments).mockResolvedValue([]);
    vi.mocked(addTaskComment).mockResolvedValue({id:"comment"} as never);
  });
  it("lista ne preuzima opseg iz URL-a, a dashboard filter šalje servisu",async()=>{
    await GET(request("/api/tasks?projectId=other&open=1&assignedProjects=1&due=OVERDUE"));
    expect(listTasks).toHaveBeenCalledWith(expect.anything(),actor,expect.objectContaining({projectId:"other",open:true,assignedProjects:true,due:"OVERDUE"}));
  });
  it("kreiranje, izmjena i oba komentara prenose tačan session scope",async()=>{
    await POST(request("/api/tasks",{title:"T",projectId:"other"}));
    await PATCH(request("/api/tasks/task",{status:"DONE"}),params);
    await COMMENTS(request("/api/tasks/task/comments"),params);
    await COMMENT(request("/api/tasks/task/comments",{body:"A"}),params);
    expect(saveTask).toHaveBeenCalledWith(expect.anything(),actor,expect.objectContaining({title:"T",projectId:"other"}),false);
    expect(saveTask).toHaveBeenCalledWith(expect.anything(),actor,expect.objectContaining({id:"task",status:"DONE"}),true);
    expect(listTaskComments).toHaveBeenCalledWith(expect.anything(),actor,"task");
    expect(addTaskComment).toHaveBeenCalledWith(expect.anything(),actor,"task","A",null);
  });
});

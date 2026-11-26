import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getVerifiedPool } from "./db";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import { GET as TASKS, POST as CREATE } from "../app/api/tasks/route";
import { PATCH } from "../app/api/tasks/[id]/route";
import { GET as COMMENTS, POST as COMMENT } from "../app/api/tasks/[id]/comments/route";
vi.mock("./db",()=>({getVerifiedPool:vi.fn()}));
import { addTaskComment, listTaskComments, listTasks, saveTask } from "./task-service";
import type { TaskActor } from "./task-scope";

const adminUrl = process.env.DATABASE_ADMIN_URL, appUrl = process.env.DATABASE_URL;
const run = adminUrl && appUrl ? describe : describe.skip;
const name = `task_scope_${process.pid}_${Date.now()}`;
const rootUrl = new URL(adminUrl ?? "postgresql://localhost/postgres"); rootUrl.pathname = "/postgres";
const dbUrl = new URL(rootUrl); dbUrl.pathname = `/${name}`;
const runtimeUrl = new URL(appUrl ?? "postgresql://localhost/postgres"); runtimeUrl.pathname = `/${name}`;
const migrations = fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));

run("task scope — lista, brojači, izmjena i komentari pod RLS", () => {
  const root = new Client(rootUrl.toString()), admin = new Client(dbUrl.toString());
  const app = new Pool({ connectionString: runtimeUrl.toString() });
  const owner: TaskActor = { userId:"ts-u", companyId:"ts-a", roles:["OWNER"], scope:"COMPANY", projectIds:null };
  const project: TaskActor = { ...owner, scope:"PROJECTS", projectIds:["ts-p1"] };
  const self: TaskActor = { ...owner, scope:"SELF", projectIds:[] };
  beforeAll(async () => {
    vi.stubEnv("AUTH_SECRET","test-secret-with-at-least-32-characters");
    vi.mocked(getVerifiedPool).mockResolvedValue(app);
    await root.connect(); await root.query(`CREATE DATABASE ${name}`); await admin.connect();
    await admin.query(readFileSync(fileURLToPath(new URL("../../../../packages/db/bootstrap/roles.sql", import.meta.url)), "utf8"));
    for (const dir of readdirSync(migrations).sort()) await admin.query(readFileSync(`${migrations}/${dir}/migration.sql`, "utf8"));
    await admin.query(readFileSync(fileURLToPath(new URL("../../../../packages/db/bootstrap/grants.sql", import.meta.url)), "utf8"));
    await admin.query("INSERT INTO public.companies(id,name,slug) VALUES ('ts-a','A','ts-a'),('ts-b','B','ts-b')");
    await admin.query("INSERT INTO public.users(id,email,first_name,last_name,password_hash,must_change_password) VALUES ('ts-u','ts@example.test','A','B','x',false)");
    await admin.query(`INSERT INTO public.memberships(id,company_id,user_id,roles,scope) VALUES ('ts-m','ts-a','ts-u',ARRAY['OWNER']::"Role"[],'PROJECTS')`);
    await admin.query("INSERT INTO public.sessions(id,company_id,user_id,token_hash,expires_at) VALUES ('ts-session','ts-a','ts-u','hash',now()+interval '1 day')");
    await admin.query("INSERT INTO public.projects(id,company_id,code,name) VALUES ('ts-p1','ts-a','P1','P1'),('ts-p2','ts-a','P2','P2'),('ts-pb','ts-b','P','PB')");
    await admin.query("INSERT INTO public.workers(id,company_id,user_id,first_name,last_name,hired_at) VALUES ('ts-w','ts-a','ts-u','A','B','2020-01-01')");
    await admin.query("INSERT INTO public.project_assignments(id,company_id,project_id,worker_id,from_date,created_by) VALUES ('ts-ass','ts-a','ts-p1','ts-w','2020-01-01','ts-u')");
    await admin.query(`INSERT INTO public.project_phases(id,company_id,project_id,code,name,created_by,updated_by) VALUES
      ('ts-ph1','ts-a','ts-p1','F','F','ts-u','ts-u'),('ts-ph2','ts-a','ts-p2','F','F','ts-u','ts-u')`);
    await admin.query(`INSERT INTO public.project_tasks(id,company_id,project_id,title,due_on,assignee_user_id,created_by,updated_by) VALUES
      ('ts-t1','ts-a','ts-p1','A',CURRENT_DATE-3,'ts-u','ts-u','ts-u'),('ts-t2','ts-a','ts-p2','B',CURRENT_DATE-2,NULL,'ts-u','ts-u'),
      ('ts-tb','ts-b','ts-pb','C',CURRENT_DATE-1,NULL,'ts-u','ts-u')`);
    await admin.query(`INSERT INTO public.task_comments(id,company_id,task_id,author_id,body) VALUES
      ('ts-c1','ts-a','ts-t1','ts-u','A'),('ts-c2','ts-a','ts-t2','ts-u','B'),('ts-cb','ts-b','ts-tb','ts-u','C')`);
  }, 120_000);
  afterAll(async () => { await app.end(); await admin.end(); await root.query(`DROP DATABASE IF EXISTS ${name}`); await root.end(); vi.unstubAllEnvs(); });

  it("stvarna JWT sesija i HTTP rute ne mogu zaobići dodijeljeni projekat",async()=>{
    const cookie=`${ACCESS_COOKIE}=${issueAccessToken({sub:"ts-u",sid:"ts-session",companyId:"ts-a"})}`;
    const req=(path:string,method="GET",body?:object)=>new NextRequest(`http://interni${path}`,{
      method,headers:{cookie,"content-type":"application/json"},...(body ? {body:JSON.stringify(body)} : {})});
    const list=await TASKS(req("/api/tasks")); expect(list.status).toBe(200);
    const payload=await list.json() as {data:{tasks:{id:string}[];counts:{open:number}}};
    expect(payload.data.tasks.map(x=>x.id)).toEqual(["ts-t1"]); expect(payload.data.counts.open).toBe(1);
    expect((await TASKS(req("/api/tasks?projectId=ts-p2"))).status).toBe(200);
    const other=await TASKS(req("/api/tasks?projectId=ts-p2"));
    expect((await other.json() as {data:{tasks:unknown[]}}).data.tasks).toEqual([]);
    expect((await PATCH(req("/api/tasks/ts-t2","PATCH",{title:"Nedozvoljeno"}),{params:Promise.resolve({id:"ts-t2"})})).status).toBe(404);
    expect((await CREATE(req("/api/tasks","POST",{title:"Nedozvoljeno",projectId:"ts-p2"}))).status).toBe(403);
    expect((await COMMENT(req("/api/tasks/ts-t2/comments","POST",{body:"Ne"}),{params:Promise.resolve({id:"ts-t2"})})).status).toBe(404);
    const comments=await COMMENTS(req("/api/tasks/ts-t2/comments"),{params:Promise.resolve({id:"ts-t2"})});
    expect((await comments.json() as {data:{comments:unknown[]}}).data.comments).toEqual([]);
  });
  it("opseg se primjenjuje na listu i sve brojače, bez premošćavanja query projektom", async () => {
    const all = await listTasks(app, owner, {}); expect("tasks" in all && all.tasks.map(x=>x.id).sort()).toEqual(["ts-t1","ts-t2"]);
    const scoped = await listTasks(app, project, {}); expect(scoped).toMatchObject({tasks:[{id:"ts-t1"}], counts:{open:1,overdue:1}});
    expect(await listTasks(app, project, {projectId:"ts-p2"})).toMatchObject({tasks:[], counts:{open:1,overdue:1}});
    expect(await listTasks(app, {...project,projectIds:[]}, {})).toMatchObject({tasks:[],counts:{open:0,overdue:0}});
    expect(await listTasks(app, self, {})).toMatchObject({tasks:[{id:"ts-t1"}], counts:{open:1}});
  });
  it("istorijski pogrešno vezana faza drugog projekta ne otkriva podatke faze",async()=>{
    await admin.query("UPDATE public.project_tasks SET phase_id='ts-ph2' WHERE id='ts-t1'");
    const rows=await listTasks(app,project,{});
    expect(rows).toMatchObject({tasks:[{id:"ts-t1",phase_id:null,phase_name:null}]});
    await admin.query("UPDATE public.project_tasks SET phase_id=NULL WHERE id='ts-t1'");
  });
  it("dashboard filter zadataka koristi aktivne dodjele i filter prije LIMIT-a", async () => {
    const overdue = await listTasks(app, owner, {assignedProjects:true,open:true,due:"OVERDUE"});
    expect(overdue).toMatchObject({tasks:[{id:"ts-t1"}]});
    const noAssignment = await listTasks(app, {...project,projectIds:["ts-p2"]}, {assignedProjects:true,open:true});
    expect(noAssignment).toMatchObject({tasks:[]});
  });
  it("čuva oboje: izvorni i ciljni projekat za izmjenu/kreiranje, bez obzira na projects.manage", async () => {
    expect(await saveTask(app, project, {id:"ts-t2",title:"Nevidljiv"}, true)).toMatchObject({code:"NOT_FOUND"});
    expect(await saveTask(app, project, {id:"ts-tb",title:"Druga firma"}, true)).toMatchObject({code:"NOT_FOUND"});
    expect(await saveTask(app, project, {id:"ts-t1",projectId:"ts-p2"}, true)).toMatchObject({code:"FORBIDDEN"});
    expect(await saveTask(app, project, {title:"Nevidljiv",projectId:"ts-p2"}, false)).toMatchObject({code:"FORBIDDEN"});
    expect(await saveTask(app, project, {title:"Bez projekta"}, false)).toMatchObject({code:"FORBIDDEN"});
    expect(await saveTask(app, project, {id:"ts-t1",phaseId:"ts-ph2"}, true)).toMatchObject({code:"VALIDATION_FAILED"});
    expect(await saveTask(app, project, {id:"ts-t1",title:"Izmijenjen",phaseId:"ts-ph1"}, true)).toMatchObject({id:"ts-t1",title:"Izmijenjen"});
    expect(await saveTask(app, project, {title:"Dostupan",projectId:"ts-p1"}, false)).toMatchObject({title:"Dostupan",project_id:"ts-p1"});
    const supervisor: TaskActor = {...project, roles:["SITE_SUPERVISOR"]};
    expect(await saveTask(app, supervisor, {id:"ts-t2",status:"DONE"}, true)).toMatchObject({code:"NOT_FOUND"});
    expect(await saveTask(app, supervisor, {id:"ts-t1",status:"DONE"}, true)).toMatchObject({status:"DONE"});
  });
  it("ne otkriva i ne upisuje komentare izvan opsega ili tenanta", async () => {
    expect(await listTaskComments(app, project, "ts-t2")).toEqual([]);
    expect(await listTaskComments(app, project, "ts-tb")).toEqual([]);
    expect(await listTaskComments(app, project, "ts-t1")).toMatchObject([{id:"ts-c1"}]);
    expect(await addTaskComment(app, project, "ts-t2", "Ne", null)).toMatchObject({code:"NOT_FOUND"});
    expect(await addTaskComment(app, project, "ts-tb", "Ne", null)).toMatchObject({code:"NOT_FOUND"});
    expect(await addTaskComment(app, project, "ts-t1", "Da", null)).toMatchObject({body:"Da"});
  });
});

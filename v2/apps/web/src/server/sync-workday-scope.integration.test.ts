import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import { POST as pushRoute } from "@/app/api/sync/push/route";
import { GET as pullRoute } from "@/app/api/sync/pull/route";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import type { R4WorkEntryPushItem } from "@gradix/domain";
import { syncWorkdayAllowed } from "./sync-workday-scope";

const appUrl = process.env.DATABASE_URL, adminUrl = process.env.DATABASE_ADMIN_URL;
const run = randomUUID().replace(/-/g, "").slice(0, 10);
const co = `cmp_sws_${run}`, user = `usr_sws_${run}`, worker = `wrk_sws_${run}`;
const project = `prj_sws_${run}`, other = `prj_sws_other_${run}`, day = `wd_sws_${run}`, entry = `we_sws_${run}`;
const item: R4WorkEntryPushItem = { localId: "local", entityType: "work_entry", workdayId: day, workEntryId: entry,
  deviceSentAt: "2026-11-01T12:00:00Z", entry: { kind: "WORK", startedAt: "2026-11-01T08:00:00Z",
    endedAt: "2026-11-01T09:00:00Z", endState: "KNOWN_END", projectId: project, machineId: null, note: null } };

(appUrl && adminUrl ? describe : describe.skip)("workday sync scope (PostgreSQL)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  const app = new Pool({ connectionString: appUrl });
  beforeAll(async () => {
    await admin.query("INSERT INTO public.companies (id,name,slug) VALUES ($1,'scope',$2)", [co,`sws-${run}`]);
    await admin.query("INSERT INTO public.users (id,email,password_hash,first_name,last_name,must_change_password) VALUES ($1,$2,'x','Scope','Test',false)", [user,`${run}@test.example`]);
    await admin.query(`INSERT INTO public.memberships (id,user_id,company_id,roles,scope) VALUES ($1,$2,$3,ARRAY['WORKER']::"Role"[],'SELF')`, [`mem_sws_${run}`,user,co]);
    await admin.query("INSERT INTO public.sessions (id,company_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 day')", [`ses_sws_${run}`,co,user,`hash_sws_${run}`]);
    await admin.query("INSERT INTO public.workers (id,company_id,first_name,last_name,user_id,hired_at) VALUES ($1,$2,'Scope','Test',$3,'2020-01-01')", [worker,co,user]);
    await admin.query("INSERT INTO public.projects (id,company_id,code,name) VALUES ($1,$3,'A','A'),($2,$3,'B','B')", [project,other,co]);
    await admin.query("INSERT INTO public.project_assignments (id,company_id,project_id,worker_id,from_date) VALUES ($1,$2,$3,$4,'2020-01-01')", [`pas_sws_${run}`,co,project,worker]);
    await admin.query("INSERT INTO public.workdays (id,company_id,worker_id,work_date,status,created_by,updated_by) VALUES ($1,$2,$3,'2026-11-01','DRAFT',$4,$4)", [day,co,worker,user]);
    await admin.query(`INSERT INTO public.work_entries (id,company_id,workday_id,worker_id,kind,started_at,ended_at,end_state,project_id,created_by,updated_by)
      VALUES ($1,$2,$3,$4,'WORK','2026-11-01T08:00:00Z','2026-11-01T09:00:00Z','KNOWN_END',$5,$6,$6)`, [entry,co,day,worker,project,user]);
  });
  afterAll(async () => { await admin.end(); await app.end(); });
  it("PROJECTS i SELF provjeravaju postojeći cilj, odredište i kanonski dan", async () => {
    const projects = { userId:user, companyId:co, roles:["ADMIN"], scope:"PROJECTS" as const, projectIds:[project] };
    const self = { ...projects, scope:"SELF" as const, projectIds:null };
    await withCompany(app, companyId(co), async client => {
      expect(await syncWorkdayAllowed(client,projects,worker,item)).toBe(true);
      expect(await syncWorkdayAllowed(client,projects,worker,{...item, entry:{...item.entry, projectId:other}})).toBe(false);
      expect(await syncWorkdayAllowed(client,self,worker,item)).toBe(true);
      expect(await syncWorkdayAllowed(client,{...self,userId:"someone-else"},worker,item)).toBe(false);
    });
    await admin.query("UPDATE public.work_entries SET project_id=$2 WHERE company_id=$1 AND id=$3",[co,other,entry]);
    await withCompany(app, companyId(co), async client => {
      expect(await syncWorkdayAllowed(client,projects,worker,item)).toBe(false);
      expect(await syncWorkdayAllowed(client,projects,worker,{...item,workdayId:"new-local-day",workEntryId:"new-entry"})).toBe(false);
      expect(await syncWorkdayAllowed(client,self,worker,item)).toBe(true);
    });
  });
  it("stvarna SELF i PROJECTS push/pull ruta, predaja dana i opoziv opsega", async () => {
    const cookie = `${ACCESS_COOKIE}=${issueAccessToken({sub:user,sid:`ses_sws_${run}`,companyId:co})}`;
    const request = (items:unknown[]) => new NextRequest("http://interni/api/sync/push", {method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({items})});
    const ended = new Date(Date.now() - 3 * 24 * 60 * 60_000);
    ended.setUTCHours(10, 0, 0, 0);
    const started = new Date(ended.getTime() - 60 * 60_000);
    const workEntry = {localId:randomUUID(),entityType:"work_entry",workdayId:randomUUID(),workEntryId:randomUUID(),deviceSentAt:new Date().toISOString(),
      entry:{kind:"WORK",startedAt:started.toISOString(),endedAt:ended.toISOString(),endState:"KNOWN_END",projectId:project,machineId:null,note:null}};
    const sent = await pushRoute(request([workEntry]));
    expect(sent.status).toBe(200);
    const first = (await sent.json()).data.results[0];
    expect(first.status).toBe("APPLIED");
    const version = await admin.query<{header_version:number}>("SELECT header_version FROM public.workdays WHERE company_id=$1 AND id=$2",[co,first.canonicalWorkdayId]);
    const submit = {localId:randomUUID(),entityType:"workday",workdayId:first.canonicalWorkdayId,baseVersion:version.rows[0]!.header_version,
      deviceSentAt:new Date().toISOString(),status:"SUBMITTED"};
    const submitResponse = await pushRoute(request([submit]));
    expect((await submitResponse.json()).data.results[0].status).toBe("APPLIED");
    const fetchEvents = async () => {
      const response = await pullRoute(new NextRequest("http://interni/api/sync/pull",{headers:{cookie}}));
      expect(response.status).toBe(200);
      return (await response.json()).data.events as {entityId:string;entityType:string}[];
    };
    const selfEvents = await fetchEvents();
    expect(selfEvents.some(e => e.entityId===workEntry.workEntryId && e.entityType==="work_entry")).toBe(true);
    expect(selfEvents.some(e => e.entityId===first.canonicalWorkdayId && e.entityType==="workday")).toBe(true);
    try {
      await admin.query("UPDATE public.memberships SET scope='PROJECTS' WHERE id=$1", [`mem_sws_${run}`]);
      const projectsEvents = await fetchEvents();
      expect(projectsEvents.some(e => e.entityId===workEntry.workEntryId)).toBe(true);
      await withCompany(admin,companyId(co),async client => {
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("UPDATE public.project_assignments SET to_date='2020-01-02' WHERE id=$1", [`pas_sws_${run}`]);
      });
      const revoked = await pushRoute(request([workEntry]));
      expect((await revoked.json()).data.results[0].status).toBe("REJECTED");
      expect((await fetchEvents()).some(e => e.entityId===workEntry.workEntryId)).toBe(false);
    } finally {
      await admin.query("UPDATE public.memberships SET scope='SELF' WHERE id=$1", [`mem_sws_${run}`]);
    }
  });

});

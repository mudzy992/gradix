import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authenticate } from "./tenant-context";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { loadTenderCalendar } from "./tender-calendar-service";
import { changeAssignment, createAssignment, isServiceError, listAssignments } from "./project-service";
import { createTraining } from "./hse-service";

const db = process.env.DATABASE_URL && process.env.DATABASE_ADMIN_URL ? describe : describe.skip;
const run=randomUUID().slice(0,8), co=`cmp_b4_${run}`, user=`usr_b4_${run}`, w=`wrk_b4_${run}`, peer=`wrk_peer_${run}`, outsider=`wrk_out_${run}`;
const p1=`prj1_${run}`, p2=`prj2_${run}`, partner=`partner_${run}`, own=`asn_own_${run}`, peerAsn=`asn_peer_${run}`, oldAsn=`asn_old_${run}`;
const t1=`tnd1_${run}`, t2=`tnd2_${run}`, t3=`tnd3_${run}`, ob=`ob_${run}`, med=`med_${run}`, selfOb=`self_ob_${run}`, att=`att_${run}`;
const projects={userId:user,companyId:co,roles:["OWNER"],scope:"PROJECTS" as const,projectIds:[p1]};
const self={...projects,scope:"SELF" as const,projectIds:null};
const company={...projects,scope:"COMPANY" as const,projectIds:null};

db("Sweep 1B-4 session scope",()=>{
  const admin=new Pool({connectionString:process.env.DATABASE_ADMIN_URL,max:4}), app=new Pool({connectionString:process.env.DATABASE_URL,max:4});
  beforeAll(async()=>{
    await admin.query("INSERT INTO companies(id,name,slug) VALUES($1,'B4',$1)",[co]);
    await admin.query("INSERT INTO users(id,email,first_name,last_name,password_hash,must_change_password) VALUES($1,$2,'Owner','Test','x',false)",[user,`${user}@example.test`]);
    await withCompany(admin,companyId(co),async c=>{
      await c.query("INSERT INTO sessions(id,company_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",[`ses_${run}`,co,user,`hash_${run}`]);
      await c.query(`INSERT INTO memberships(id,company_id,user_id,roles,scope) VALUES($1,$2,$3,ARRAY['OWNER']::"Role"[],'PROJECTS')`,[`mem_${run}`,co,user]);
      await c.query("INSERT INTO workers(id,company_id,user_id,first_name,last_name,hired_at) VALUES($1,$4,$5,'Own','Worker','2020-01-01'),($2,$4,NULL,'Peer','Worker','2020-01-01'),($3,$4,NULL,'Outside','Worker','2020-01-01')",[w,peer,outsider,co,user]);
      await c.query("INSERT INTO projects(id,company_id,code,name) VALUES($1,$3,'P1','One'),($2,$3,'P2','Two')",[p1,p2,co]);
      await c.query("SET LOCAL session_replication_role=replica");
      await c.query(`INSERT INTO project_assignments(id,company_id,project_id,worker_id,from_date,to_date) VALUES
        ($1,$4,$5,$7,'2020-01-01',NULL),($2,$4,$5,$8,'2020-01-01',NULL),($3,$4,$5,$9,'2020-01-01','2020-02-01'),($10,$4,$6,$9,'2020-01-01',NULL),($11,$4,$6,$7,'2020-01-01',NULL)`,[own,peerAsn,oldAsn,co,p1,p2,w,peer,outsider,`asn_out_${run}`,`asn_own2_${run}`]);
      await c.query("SET LOCAL session_replication_role=origin");
      await c.query("INSERT INTO partners(id,company_id,code,name,kind) VALUES($1,$2,'P','Partner','CLIENT')",[partner,co]);
      for (const [id,prj] of [[t1,p1],[t2,p2],[t3,null]] as const) {
        await c.query(`INSERT INTO tenders(id,company_id,title,partner_id,submitted_value_cents,currency_code,status,converted_project_id,deadline_at,created_by,updated_by)
          VALUES($1,$2,$1,$3,100,'BAM','WON',$4,'2030-01-01T12:00:00Z',$5,$5)`,[id,co,partner,prj,user]);
        await c.query(`INSERT INTO tender_checklist_items(id,company_id,tender_id,code,label,guarantee_type,valid_until,bank,created_by,updated_by)
          VALUES($1,$2,$3,'G','Garancija','BID','2030-02-01','Test banka',$4,$4)`,[`g_${id}`,co,id,user]);
      }
      for (const [id,type,subject] of [[ob,`${co}_obt_safety`,peer],[med,`${co}_obt_medical`,peer],[selfOb,`${co}_obt_safety`,w]] as const) {
        await c.query("INSERT INTO obligations(id,company_id,type_id,worker_id,expires_at,created_by) VALUES($1,$2,$3,$4,'2030-01-01',$5)",[id,co,type,subject,user]);
        await c.query("INSERT INTO obligation_versions(id,company_id,obligation_id,version,expires_at,created_by) VALUES($1,$2,$3,1,'2030-01-01',$4)",[`ver_${id}`,co,id,user]);
        await c.query(`INSERT INTO attachments(id,company_id,entity_type,entity_id,object_key,file_name,content_type,size_bytes,sha256,status,uploaded_at,created_by)
          VALUES($1,$2,'OBLIGATION',$3,$4,'cert.pdf','application/pdf',12,$5,'ready',now(),$6)`,[id===ob?att:id===med?`att_med_${run}`:`att_self_${run}`,co,id,`test/${id}`,"a".repeat(64),user]);
      }
    });
  },60_000);
  afterAll(async()=>{
    await withCompany(admin,companyId(co),async c=>{await c.query("SET LOCAL session_replication_role=replica");
      for(const table of ["hse_training_attendees","hse_trainings","obligation_versions","attachments","obligations","tender_checklist_items","tenders","partner_roles","partners","project_assignments","audit_events","sessions","projects","workers","memberships"]) await c.query(`DELETE FROM public.${table} WHERE company_id=$1`,[co]);
    });
    await admin.query("DELETE FROM companies WHERE id=$1",[co]);await admin.query("DELETE FROM users WHERE id=$1",[user]);await app.end();await admin.end();
  },60_000);
  it("kalendar koristi projektnu vezu i živu dodjelu, SELF ništa",async()=>{
    const full=await loadTenderCalendar(app,company), scoped=await loadTenderCalendar(app,projects);
    expect(new Set(full.map(x=>x.tenderId))).toEqual(new Set([t1,t2,t3]));
    expect(new Set(scoped.map(x=>x.tenderId))).toEqual(new Set([t1]));
    expect(scoped.map(x=>x.kind).sort()).toEqual(["Istek garancije","Rok dostave"]);
    expect(await loadTenderCalendar(app,self)).toEqual([]);
    expect(await loadTenderCalendar(app,{...projects,projectIds:[]})).toEqual([]);
    const cookie=`${ACCESS_COOKIE}=${issueAccessToken({sub:user,sid:`ses_${run}`,companyId:co})}`;
    const authenticateSession=() => authenticate(new NextRequest("http://local/ured/tenderi/kalendar",{headers:{cookie}}));
    const auth=await authenticateSession();
    if (!auth.ok) throw new Error("session auth failed");
    expect(new Set((await loadTenderCalendar(app,auth.ctx)).map(x=>x.tenderId))).toEqual(new Set([t1,t2]));
    await admin.query("UPDATE memberships SET scope='SELF' WHERE id=$1",[`mem_${run}`]);
    const selfAuth=await authenticateSession();
    if (!selfAuth.ok) throw new Error("session auth failed");
    expect(await loadTenderCalendar(app,selfAuth.ctx)).toEqual([]);
    await admin.query("UPDATE memberships SET scope='PROJECTS' WHERE id=$1",[`mem_${run}`]);
  });
  it("dodjele filtriraju historiju i cilj; SELF vidi i mijenja samo vlastito",async()=>{
    const visible=await listAssignments(app,companyId(co),projects,p1);
    if(isServiceError(visible)) throw new Error(visible.message);
    expect(visible.assignments.map(x=>x.id)).toEqual(expect.arrayContaining([own,peerAsn]));
    expect(visible.assignments.map(x=>x.id)).not.toContain(oldAsn);
    const mine=await listAssignments(app,companyId(co),self,p1);
    if(isServiceError(mine)) throw new Error(mine.message);
    expect(mine.assignments.map(x=>x.id)).toEqual([own]);
    expect(await createAssignment(app,companyId(co),projects,p1,{workerId:outsider,fromDate:"2098-01-01"})).toMatchObject({code:"NOT_FOUND"});
    expect(await createAssignment(app,companyId(co),self,p1,{workerId:w,fromDate:"2098-01-01"})).toMatchObject({code:"FORBIDDEN"});
    expect(await changeAssignment(app,companyId(co),self,p1,peerAsn,{action:"END"})).toMatchObject({code:"NOT_FOUND"});
    expect(await changeAssignment(app,companyId(co),projects,p2,`asn_out_${run}`,{action:"END"})).toMatchObject({code:"NOT_FOUND"});
    const created=await createAssignment(app,companyId(co),{...projects,projectIds:[p1,p2]},p2,{workerId:peer,fromDate:"2098-01-01"});
    if (isServiceError(created)) throw new Error(created.message);
    expect(await changeAssignment(app,companyId(co),{...projects,projectIds:[p1,p2]},p2,created.id,{action:"VOID",reason:"Greška pri planiranju"})).toMatchObject({ok:true,action:"VOID"});
    expect(await changeAssignment(app,companyId(co),self,p2,`asn_own2_${run}`,{action:"END"})).toMatchObject({ok:true,action:"END"});
  });
  it("HSE obnavlja samo certifikat i samo uz dozvolu i žive dodjele",async()=>{
    const base={kind:"CERTIFICATION" as const,title:"Certifikacija",heldAt:"2029-01-01T10:00:00Z",projectId:p1,
      attendees:[{workerId:peer,signatureName:"Peer Worker",signedAt:"2029-01-01T10:00:00Z"}],renewObligationId:ob,renewAttachmentId:att,renewExpiresAt:"2032-01-01"};
    expect(await createTraining(app,{...projects,roles:["SITE_SUPERVISOR"]},base)).toMatchObject({outcome:"FORBIDDEN"});
    expect(await createTraining(app,projects,{...base,renewObligationId:med,renewAttachmentId:`att_med_${run}`})).toMatchObject({outcome:"VALIDATION_FAILED",code:"OBLIGATION_TYPE"});
    expect(await createTraining(app,self,base)).toMatchObject({outcome:"NOT_FOUND"});
    const selfInput={...base,attendees:[{workerId:w,signatureName:"Own Worker",signedAt:base.heldAt}],renewObligationId:selfOb,renewAttachmentId:`att_self_${run}`};
    expect((await createTraining(app,self,selfInput)).outcome).toBe("OK");
    expect((await createTraining(app,projects,base)).outcome).toBe("OK");
    expect((await admin.query("SELECT current_version,expires_at::text,review_state FROM obligations WHERE company_id=$1 AND id=$2",[co,ob])).rows[0]).toEqual({current_version:2,expires_at:"2032-01-01",review_state:"pending_review"});
    // A committed revocation which holds the grant lock first must beat a concurrent renewal.
    const conn=await admin.connect();
    try {
      await conn.query("BEGIN"); await conn.query("SET LOCAL session_replication_role=replica");
      await conn.query("UPDATE project_assignments SET to_date='2020-02-01' WHERE id=$1",[own]);
      const pending=createTraining(app,projects,{...base,renewExpiresAt:"2033-01-01"});
      let blocked=false;
      for(let i=0;i<100 && !blocked;i++) {
        blocked=!!(await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%project_assignments pa%'")).rowCount;
        if(!blocked) await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(blocked).toBe(true);
      await conn.query("COMMIT");
      expect(await pending).toMatchObject({outcome:"NOT_FOUND"});
    } finally {await conn.query("ROLLBACK");conn.release();}
    expect(await loadTenderCalendar(app,projects)).toEqual([]);
    expect(await listAssignments(app,companyId(co),projects,p1)).toMatchObject({code:"NOT_FOUND"});
    expect(await createAssignment(app,companyId(co),projects,p1,{workerId:peer,fromDate:"2098-01-01"})).toMatchObject({code:"NOT_FOUND"});
    expect(await changeAssignment(app,companyId(co),projects,p1,peerAsn,{action:"END"})).toMatchObject({code:"NOT_FOUND"});
    expect(await createTraining(app,projects,{...base,renewExpiresAt:"2033-01-01"})).toMatchObject({outcome:"NOT_FOUND"});
  });
});

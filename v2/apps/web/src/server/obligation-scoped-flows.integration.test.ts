import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId } from "@gradix/db";
import { isServiceError, renewObligation } from "./obligation-service";
import { createTraining } from "./hse-service";
import { listMissing, createMissingObligations } from "./obligation-requirement-service";
import { previewImport, applyImport } from "./obligation-import-service";
import { listOverrideRequests, requestOverride, approveOverride } from "./project-service";
import { loadDeadlinesReport } from "./report-deadlines";
import { POST as bulkRoute } from "@/app/api/obligations/bulk-renew/route";
import { ACCESS_COOKIE, issueAccessToken } from "./session";

const appUrl = process.env.DATABASE_URL, adminUrl = process.env.DATABASE_ADMIN_URL;
const db = appUrl && adminUrl ? describe : describe.skip;
const run = randomUUID().replace(/-/g, "").slice(0, 10);
const co = `cmp_obsc_${run}`, user = `usr_obsc_${run}`, selfUser = `usr_obself_${run}`;
const project = `prj_obsc_${run}`, otherProject = `prj_obout_${run}`;
const own = `wrk_obsc_${run}`, outsider = `wrk_obout_${run}`, pmWorker = `wrk_obpm_${run}`, machine = `mch_obsc_${run}`;
const assign = `pas_obsc_${run}`, ownOb = `obl_obsc_${run}`, outOb = `obl_obout_${run}`, machineOb = `obl_obm_${run}`;
const type = `obt_obsc_${run}`, requirementType = `obt_obmissing_${run}`;
const pm = {userId:user, companyId:co, roles:["OWNER" as const], scope:"PROJECTS" as const, projectIds:[project]};
const self = {userId:selfUser, companyId:co, roles:["OWNER" as const], scope:"SELF" as const, projectIds:null};
const owner = {...pm, scope:"COMPANY" as const, projectIds:null};

db("scope preostalih tokova obaveza (PostgreSQL)", () => {
  const admin = new Pool({connectionString:adminUrl,max:4}), app = new Pool({connectionString:appUrl,max:6});
  beforeAll(async () => {
    await admin.query("INSERT INTO companies (id,name,slug) VALUES ($1,'Scope',$2)", [co, `scope-${run}`]);
    await admin.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,must_change_password)
      VALUES ($1,$2,'x','PM','Scope',false),($3,$4,'x','Own','User',false)`, [user,`pm-${run}@test.example`,selfUser,`own-${run}@test.example`]);
    await admin.query(`INSERT INTO memberships(id,company_id,user_id,roles,scope) VALUES
      ($1,$2,$3,ARRAY['OWNER']::"Role"[],'PROJECTS'),($4,$2,$5,ARRAY['OWNER']::"Role"[],'SELF')`, [`mem_${user}`,co,user,`mem_${selfUser}`,selfUser]);
    await admin.query(`INSERT INTO sessions(id,company_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 day')`, [`ses_${user}`,co,user,`hash_${run}`]);
    await admin.query(`INSERT INTO workers(id,company_id,user_id,first_name,last_name,hired_at) VALUES
      ($1,$2,$3,'Amina','Scoped','2020-01-01'),($4,$2,NULL,'Branko','Outside','2020-01-01'),($5,$2,$6,'Manager','Scoped','2020-01-01')`, [own,co,selfUser,outsider,pmWorker,user]);
    await admin.query("INSERT INTO projects(id,company_id,code,name) VALUES ($1,$2,'A','A'),($3,$2,'B','B')", [project,co,otherProject]);
    await admin.query("INSERT INTO machines(id,company_id,code,name,category_id) VALUES ($1,$2,'M1','Excavator',$2 || '_cat_excavator')", [machine,co]);
    await admin.query(`INSERT INTO project_assignments(id,company_id,project_id,worker_id,machine_id,from_date) VALUES
      ($1,$2,$3,$4,NULL,'2020-01-01'),($5,$2,$3,$6,NULL,'2020-01-01'),($7,$2,$3,NULL,$8,'2020-01-01'),($9,$2,$10,$11,NULL,'2020-01-01')`,
      [assign,co,project,own,`pas_pm_${run}`,pmWorker,`pas_m_${run}`,machine,`pas_out_${run}`,otherProject,outsider]);
    await admin.query(`INSERT INTO obligation_types(id,company_id,code,label,entity_kind,requires_attachment) VALUES
      ($1,$2,'SCOPE_CERT','Scoped certificate','WORKER',false),($3,$2,'SCOPE_MISSING','Scoped missing','WORKER',false)`, [type,co,requirementType]);
    for (const [id, worker] of [[ownOb,own],[outOb,outsider]] as const) {
      await admin.query("INSERT INTO obligations(id,company_id,type_id,worker_id,expires_at,created_by,responsible_user_id) VALUES ($1,$2,$3,$4,'2030-01-01',$5,$6)", [id,co,type,worker,user,selfUser]);
      await admin.query("INSERT INTO obligation_versions(id,company_id,obligation_id,version,expires_at,created_by) VALUES ($1,$2,$3,1,'2030-01-01',$4)", [`obv_${id}`,co,id,user]);
    }
    await admin.query("INSERT INTO obligations(id,company_id,type_id,machine_id,expires_at,created_by) VALUES ($1,$2,$2 || '_obt_registration',$3,'2030-01-01',$4)", [machineOb,co,machine,user]);
    await admin.query("INSERT INTO obligation_versions(id,company_id,obligation_id,version,expires_at,created_by) VALUES ($1,$2,$3,1,'2030-01-01',$4)", [`obv_${machineOb}`,co,machineOb,user]);
    await admin.query("INSERT INTO obligation_requirements(id,company_id,entity_kind,type_id,applies_scope,is_required,is_active) VALUES ($1,$2,'WORKER',$3,'ALL',true,true)", [`req_${run}`,co,requirementType]);
  }, 60_000);
  afterAll(async () => { await admin.end(); await app.end(); });

  it("HSE obnavlja samo prisutnog dozvoljenog radnika i čuva historiju", async () => {
    const attachment = `att_cert_${run}`;
    await admin.query(`INSERT INTO attachments(id,company_id,entity_type,entity_id,object_key,file_name,content_type,size_bytes,sha256,status,uploaded_at,created_by)
      VALUES ($1,$2,'OBLIGATION',$3,$4,'cert.pdf','application/pdf',12,$5,'ready',now(),$6)`, [attachment,co,ownOb,`test/${run}`,"a".repeat(64),user]);
    const base = {kind:"CERTIFICATION" as const,title:"Certifikacija",heldAt:"2029-01-01T10:00:00Z",projectId:project,
      attendees:[{workerId:own,signatureName:"Amina Scoped",signedAt:"2029-01-01T10:00:00Z"}],renewExpiresAt:"2032-01-01",renewAttachmentId:attachment};
    expect((await createTraining(app,pm,{...base,renewObligationId:outOb})).outcome).toBe("NOT_FOUND");
    expect((await createTraining(app,pm,{...base,renewObligationId:ownOb,attendees:[{workerId:pmWorker,signatureName:"Manager Scoped",signedAt:base.heldAt}]})).outcome).toBe("NOT_FOUND");
    expect((await createTraining(app,pm,{...base,renewObligationId:ownOb,renewExpiresAt:undefined})).outcome).toBe("VALIDATION_FAILED");
    expect((await createTraining(app,pm,{...base,renewObligationId:ownOb,renewAttachmentId:undefined})).outcome).toBe("VALIDATION_FAILED");
    expect((await createTraining(app,pm,{...base,renewObligationId:ownOb})).outcome).toBe("OK");
    const versions = await admin.query("SELECT version,expires_at::text FROM obligation_versions WHERE company_id=$1 AND obligation_id=$2 ORDER BY version", [co,ownOb]);
    expect(versions.rows).toEqual([{version:1,expires_at:"2030-01-01"},{version:2,expires_at:"2032-01-01"}]);
    const state = await admin.query("SELECT review_state,reviewed_by FROM obligations WHERE id=$1 AND company_id=$2",[ownOb,co]);
    expect(state.rows[0]).toEqual({review_state:"pending_review",reviewed_by:null});
  });

  it("kalendar/izvještaj i iznimke ne otkrivaju tuđe radnike", async () => {
    const filters = {from:"2029-01-01",to:"2035-01-01"};
    const pmReport = await loadDeadlinesReport(app,pm,filters), selfReport = await loadDeadlinesReport(app,self,filters);
    expect(pmReport.rows.flat()).toContain("Amina Scoped");
    expect(pmReport.rows.flat()).not.toContain("Branko Outside");
    expect(selfReport.rows.flat()).toContain("Amina Scoped");
    expect(selfReport.rows.flat()).not.toContain("Branko Outside");
    expect(selfReport.rows.flat()).not.toContain("Excavator");
    const filtered = await loadDeadlinesReport(app,pm,{...filters,projectId:otherProject});
    expect(filtered.rows).toEqual([]);
    const inReq = await requestOverride(app,companyId(co),pm,project,{obligationId:ownOb,workerId:own,reason:"Potrebna validna iznimka",fromDate:"2032-01-01"});
    expect("message" in inReq).toBe(false);
    const outReq = await requestOverride(app,companyId(co),owner,otherProject,{obligationId:outOb,workerId:outsider,reason:"Potrebna validna iznimka",fromDate:"2032-01-01"});
    expect("message" in outReq).toBe(false);
    if ("message" in outReq) return;
    expect((await listOverrideRequests(app,companyId(co),pm)).map(x=>x.id)).not.toContain(outReq.id);
    expect((await listOverrideRequests(app,companyId(co),self)).map(x=>x.id)).not.toContain(outReq.id);
    const approval = await approveOverride(app,companyId(co),pm,outReq.id,{validUntil:"2035-01-01"});
    expect("code" in approval && approval.code).toBe("NOT_FOUND");
    expect("code" in await requestOverride(app,companyId(co),pm,project,{obligationId:outOb,workerId:outsider,reason:"Potrebna validna iznimka",fromDate:"2032-01-01"})).toBe(true);
  });

  it("missing i uvoz koriste samo dopuštene entitete", async () => {
    const missing = await listMissing(app,companyId(co),{typeId:requirementType},pm);
    expect(missing.items.map(x=>x.entityId)).toContain(own);
    expect(missing.items.map(x=>x.entityId)).not.toContain(outsider);
    const ownMissing = await listMissing(app,companyId(co),{typeId:requirementType},self);
    expect(ownMissing.items.map(x=>x.entityId)).toEqual([own]);
    const file = Buffer.from("Vrsta,Entitet,Tip obaveze,Istice\nRadnik,Amina Scoped,Scoped missing,2033-01-01\nRadnik,Branko Outside,Scoped missing,2033-01-01\n");
    const preview = await previewImport(app,companyId(co),file,"scope.csv",pm);
    if ("code" in preview) throw new Error(JSON.stringify(preview));
    expect(preview.rows.map(r=>r.valid)).toEqual([true,false]);
    const applied = await applyImport(app,companyId(co),file,"scope.csv",{replaceExisting:false},pm);
    if ("code" in applied) throw new Error(JSON.stringify(applied));
    expect(applied).toMatchObject({created:1,skipped:1});
    const made = await createMissingObligations(app,companyId(co),{typeId:requirementType,reviewAt:"2035-01-01"},pm);
    const subjects = await admin.query("SELECT worker_id FROM obligations WHERE company_id=$1 AND id=ANY($2::text[])",[co,made.ids]);
    expect(subjects.rows.map(r=>r.worker_id)).not.toContain(outsider);
  });

  it("grupna obnova dijeli uspjehe i odbijanja po scopeu", async () => {
    const cookie = `${ACCESS_COOKIE}=${issueAccessToken({sub:user,sid:`ses_${user}`,companyId:co})}`;
    const response = await bulkRoute(new NextRequest("http://t/api/obligations/bulk-renew",{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({obligationIds:[machineOb,outOb],expiresAt:"2034-01-01"})}));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.renewed).toBe(1);
    expect(body.data.failed).toHaveLength(1);
    const row = await admin.query("SELECT expires_at::text FROM obligations WHERE company_id=$1 AND id=$2",[co,outOb]);
    expect(row.rows[0].expires_at).toBe("2030-01-01");
  });

  it("opoziv dodjele koji zaključa red prvi sprečava konkurentnu obnovu", async () => {
    const connection = await admin.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("UPDATE project_assignments SET voided_at=now(),voided_by=$2,void_reason='Poništavanje za test' WHERE id=$1",[assign,user]);
      const pending = renewObligation(app,companyId(co),pm,ownOb,{expiresAt:"2036-01-01"});
      // Wait deterministically for PostgreSQL's row-lock wait, not an arbitrary sleep.
      let blocked = false;
      for (let i=0;i<100 && !blocked;i++) {
        const locks = await admin.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%project_assignments pa%' AND datname=current_database()");
        blocked = !!locks.rowCount;
        if (!blocked) await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(blocked).toBe(true);
      await connection.query("COMMIT");
      const result = await pending;
      expect(isServiceError(result) && result.code).toBe("NOT_FOUND");
      const row = await admin.query("SELECT expires_at::text FROM obligations WHERE id=$1 AND company_id=$2",[ownOb,co]);
      expect(row.rows[0].expires_at).toBe("2032-01-01");
    } finally { await connection.query("ROLLBACK"); connection.release(); }
  });
  it("opozvana vlastita dodjela ne ostaje pravo kroz zastarjeli session projectIds", async () => {
    await admin.query("UPDATE project_assignments SET voided_at=now(),voided_by=$2,void_reason='Promjena opsega za test' WHERE id=$1", [`pas_pm_${run}`,user]);
    const result = await renewObligation(app,companyId(co),pm,machineOb,{expiresAt:"2037-01-01"});
    expect(isServiceError(result) && result.code).toBe("NOT_FOUND");
    const report = await loadDeadlinesReport(app,pm,{from:"2029-01-01",to:"2040-01-01"});
    expect(report.rows).toEqual([]);
  });

});

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { PendingManualCostsResponse, SubcontractAmendmentsResponse } from "@gradix/contracts";
import { listPendingManualCosts } from "./phase-10b-list-service";
import { createManualCost } from "./cost-entry-service";
import { decideManualCost } from "./manual-cost-approval-service";
import { amendSubContract, createSubContract, patchSubContract, listSubContractAmendments, listSubcontractorPartners } from "./subcontract-contract-service";
import { approveSubStatement, createSubStatement, getSubStatement } from "./subcontract-statement-service";
import type { PurchaseActor } from "./purchase-request-service";

const adminUrl=process.env.DATABASE_ADMIN_URL, appUrl=process.env.DATABASE_URL;
const describeDb=adminUrl && appUrl ? describe : describe.skip;
const run=randomUUID().replace(/-/g,"");
const company=`sca_${run}`,other=`scb_${run}`,user=`scu_${run}`,project=`scp_${run}`,partner=`scpt_${run}`,category=`scc_${run}`;
const owner:PurchaseActor={companyId:company,userId:user,roles:["OWNER"],scope:"COMPANY",projectIds:null};
const pm:PurchaseActor={...owner,roles:["PROJECT_MANAGER"],scope:"PROJECTS",projectIds:[project]};
describeDb("F10A-3 podizvođači i ručni trošak",()=>{
  const admin=new Pool({connectionString:adminUrl}),app=new Pool({connectionString:appUrl});
  beforeAll(async()=>{
    await admin.query("INSERT INTO companies(id,name,slug) VALUES ($1,'A',$1),($2,'B',$2)",[company,other]);
    await admin.query("INSERT INTO users(id,email,first_name,last_name,password_hash) VALUES ($1,$2,'A','B','x')",[user,`${user}@test.example`]);
    await withCompany(admin,companyId(company),async client=>{
      await client.query("INSERT INTO projects(id,company_id,code,name,status) VALUES ($1,$2,'P','Projekt','ACTIVE')",[project,company]);
      await client.query("INSERT INTO partners(id,company_id,code,name,kind) VALUES ($1,$2,'S','Izvođač','SUBCONTRACTOR')",[partner,company]);
      await client.query("INSERT INTO cost_categories(id,company_id,code,name) VALUES ($1,$2,'MAN','Ručni')",[category,company]);
    });
  });
  afterAll(async()=>{
    await withCompany(admin,companyId(company),async client=>{
      await client.query("SET LOCAL session_replication_role=replica");
      for(const table of ["approval_requests","manual_cost_requests","cost_entries","subcontractor_statement_items","subcontractor_statements","subcontractor_contract_amendments","subcontractor_contracts","cost_categories","partner_roles","partners","projects","audit_events"]) await client.query(`DELETE FROM ${table} WHERE company_id=$1`,[company]);
    });
    await admin.query("DELETE FROM companies WHERE id=ANY($1)",[[company,other]]); await admin.query("DELETE FROM users WHERE id=$1",[user]);
    await app.end(); await admin.end();
  });
  it("situacija knjizi bruto jednom, uz zadržavanje, garanciju, upozorenje i aneks",async()=>{
    const contractInput={clientGeneratedId:randomUUID(),projectId:project,partnerId:partner,code:"UG-1",title:"Radovi",contractValueCents:"10000",currencyCode:"BAM" as const,retentionPct:"10.00",warrantyPct:"5.00"};
    expect((await createSubContract(app,{...pm,projectIds:[]},contractInput)).outcome).toBe("FORBIDDEN");
    const created=await createSubContract(app,pm,contractInput); if(created.outcome!=="OK") throw Error(created.message);
    expect(await createSubContract(app,pm,contractInput)).toEqual(created);
    expect((await patchSubContract(app,pm,created.data.id,{status:"ACTIVE"})).outcome).toBe("OK");
    const input={clientGeneratedId:randomUUID(),contractId:created.data.id,statementNo:"1",periodFrom:"2026-11-01",periodTo:"2026-11-23",items:[{description:"Radovi",amountCents:"12000"}]};
    const statement=await createSubStatement(app,pm,input); if(statement.outcome!=="OK") throw Error(statement.message);
    const detail=await getSubStatement(app,pm,statement.data.id);
    expect(detail).toMatchObject({outcome:"OK",data:{statement:{gross_cents:"12000",retention_cents:"1200",warranty_cents:"600",net_cents:"10200"}}});
    const approved=await approveSubStatement(app,pm,statement.data.id);
    expect(approved).toMatchObject({outcome:"OK",data:{warnings:["SUBCONTRACTOR_CONTRACT_EXCEEDED"],alreadyApproved:false}});
    expect(await approveSubStatement(app,pm,statement.data.id)).toMatchObject({outcome:"OK",data:{alreadyApproved:true,warnings:["SUBCONTRACTOR_CONTRACT_EXCEEDED"]}});
    await withCompany(admin,companyId(company),async client=>{
      await client.query("SAVEPOINT immutable");
      await expect(client.query("UPDATE subcontractor_statements SET gross_cents=1 WHERE company_id=$1 AND id=$2",[company,statement.data.id])).rejects.toThrow(/IMMUTABLE/);
      await client.query("ROLLBACK TO SAVEPOINT immutable");
      await client.query("SAVEPOINT reversal");
      await expect(client.query("UPDATE cost_entries SET status='REVERSED',note='test' WHERE company_id=$1 AND source_type='SUBCONTRACTOR' AND source_id=$2",[company,statement.data.id])).rejects.toThrow(/REVERSAL_FORBIDDEN/);
      await client.query("ROLLBACK TO SAVEPOINT reversal");
    });
    const costs=await withCompany(admin,companyId(company),client=>client.query<{amount:string;category:string}>(`SELECT e.amount_cents::text AS amount,c.code AS category FROM cost_entries e JOIN cost_categories c ON c.company_id=e.company_id AND c.id=e.category_id
      WHERE e.company_id=$1 AND e.source_type='SUBCONTRACTOR' AND e.source_id=$2`,[company,statement.data.id]));
    expect(costs.rows).toEqual([{amount:"12000",category:"PODIZVOĐAČI"}]);
    const amend={clientGeneratedId:randomUUID(),valueAmendmentCents:"5000",reason:"Dodatni radovi na objektu"};
    expect((await amendSubContract(app,owner,created.data.id,amend)).outcome).toBe("OK");
    const amendments=await listSubContractAmendments(app,pm,created.data.id);
    expect(amendments.outcome).toBe("OK");
    if(amendments.outcome==="OK") {
      expect(SubcontractAmendmentsResponse.safeParse({amendments:amendments.data}).success).toBe(true);
      expect(amendments.data).toContainEqual(expect.objectContaining({value_amendment_cents:"5000",reason:amend.reason}));
    }
    expect((await listSubContractAmendments(app,{...pm,projectIds:[]},created.data.id)).outcome).toBe("NOT_FOUND");
    expect((await listSubContractAmendments(app,{...owner,companyId:other},created.data.id)).outcome).toBe("NOT_FOUND");
    expect((await listSubContractAmendments(app,{...owner,roles:["WORKER"]},created.data.id)).outcome).toBe("FORBIDDEN");
    expect(await listSubcontractorPartners(app,owner)).toContainEqual(expect.objectContaining({id:partner}));
    expect(await listSubcontractorPartners(app,{...owner,companyId:other})).toEqual([]);

    const next=await createSubStatement(app,owner,{...input,clientGeneratedId:randomUUID(),statementNo:"2",items:[{description:"Dodatni radovi",amountCents:"2000"}]});
    if(next.outcome!=="OK") throw Error(next.message);
    expect(await approveSubStatement(app,owner,next.data.id)).toMatchObject({outcome:"OK",data:{warnings:[]}});
    const third=await createSubStatement(app,owner,{...input,clientGeneratedId:randomUUID(),statementNo:"3",items:[{description:"Radovi",amountCents:"600"}]});
    const fourth=await createSubStatement(app,owner,{...input,clientGeneratedId:randomUUID(),statementNo:"4",items:[{description:"Radovi",amountCents:"600"}]});
    if(third.outcome!=="OK" || fourth.outcome!=="OK") throw Error("Situacije nisu kreirane");
    const concurrent=await Promise.all([approveSubStatement(app,owner,third.data.id),approveSubStatement(app,owner,fourth.data.id)]);
    expect(concurrent.every(x=>x.outcome==='OK')).toBe(true);
    expect(concurrent.filter(x=>x.outcome==='OK' && x.data.warnings.includes('SUBCONTRACTOR_CONTRACT_EXCEEDED'))).toHaveLength(1);
    expect((await getSubStatement(app,{...owner,companyId:other},statement.data.id)).outcome).toBe("NOT_FOUND");
    expect((await getSubStatement(app,{...pm,projectIds:[]},statement.data.id)).outcome).toBe("NOT_FOUND");
  });
  it("dvostruki ručni trošak i prag 500 KM: iznad čeka vlasnika bez knjiženja",async()=>{
    const actor={...pm,roles:["PROJECT_MANAGER"] as const};
    const small={clientGeneratedId:randomUUID(),projectId:project,categoryId:category,occurredOn:"2026-11-23",amount:"500.00",currencyCode:"BAM" as const};
    const [a,b]=await Promise.all([createManualCost(app,actor,small),createManualCost(app,actor,small)]);
    expect(a).toEqual(b); expect(a).toMatchObject({outcome:"OK",approvalRequired:false});
    expect((await createManualCost(app,actor,{...small,amount:"499.00"})).outcome).toBe("CONFLICT");
    const large={...small,clientGeneratedId:randomUUID(),amount:"500.01"};
    const pending=await createManualCost(app,actor,large); expect(pending).toMatchObject({outcome:"OK",approvalRequired:true});
    expect(await createManualCost(app,actor,large)).toEqual(pending);
    const visible=await listPendingManualCosts(app,pm,project);
    expect(visible.outcome).toBe("OK");
    if (visible.outcome === "OK") {
      expect(PendingManualCostsResponse.safeParse({requests:visible.data}).success).toBe(true);
      expect(visible.data).toContainEqual(expect.objectContaining({id:pending.id,amount_cents:"50001"}));
    }
    expect(await listPendingManualCosts(app,{...pm,projectIds:[]},project)).toMatchObject({outcome:"OK",data:[]});
    expect(await listPendingManualCosts(app,{...owner,companyId:other},project)).toMatchObject({outcome:"OK",data:[]});
    expect((await listPendingManualCosts(app,{...owner,roles:["WORKER"]})).outcome).toBe("FORBIDDEN");
    const before=await withCompany(admin,companyId(company),client=>client.query("SELECT 1 FROM cost_entries WHERE company_id=$1 AND client_generated_id=$2",[company,large.clientGeneratedId]));
    expect(before.rowCount).toBe(0);
    expect((await decideManualCost(app,pm,pending.id!,"approve")).outcome).toBe("FORBIDDEN");
    const approved=await decideManualCost(app,owner,pending.id!,"approve");
    expect(approved).toMatchObject({outcome:"OK",data:{status:"APPROVED"}});
    expect(await decideManualCost(app,owner,pending.id!,"approve")).toEqual(approved);
    const noLongerPending=await listPendingManualCosts(app,pm,project);
    if(noLongerPending.outcome!=="OK") throw Error(noLongerPending.message);
    expect(noLongerPending.data).not.toContainEqual(expect.objectContaining({id:pending.id}));
    const after=await withCompany(admin,companyId(company),client=>client.query<{amount:string}>("SELECT amount_cents::text AS amount FROM cost_entries WHERE company_id=$1 AND client_generated_id=$2",[company,large.clientGeneratedId]));
    expect(after.rows).toEqual([{amount:"50001"}]);
    const rejected=await createManualCost(app,actor,{...large,clientGeneratedId:randomUUID()});
    expect(rejected).toMatchObject({outcome:"OK",approvalRequired:true});
    expect((await decideManualCost(app,owner,rejected.id!,"reject","Neopravdan trošak")).outcome).toBe("OK");
    expect((await decideManualCost(app,owner,rejected.id!,"approve")).outcome).toBe("CONFLICT");
    const without=await withCompany(admin,companyId(company),client=>client.query("SELECT 1 FROM cost_entries WHERE company_id=$1 AND source_id=$2",[company,rejected.id]));
    expect(without.rowCount).toBe(0);
  });
});

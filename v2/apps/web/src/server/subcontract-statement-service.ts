import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { isCurrency, subcontractorStatementAmounts, subcontractorContractExceeded } from "@gradix/domain";
import type { SubcontractStatementInput } from "@gradix/contracts";
import { can } from "./permissions";
import { writeAudit } from "./audit";
import { ensureCostCategories, postCost } from "./cost-entry-service";
import { type PurchaseActor } from "./purchase-request-service";
import { subContract, subDenied, subHash, subId, subMissing } from "./subcontract-contract-service";
import type { WarehouseResult } from "./warehouse-service";

const fields=`s.id,s.contract_id,s.phase_id,s.period_from::text,s.period_to::text,s.statement_no,s.status,s.gross_cents::text,s.retention_pct::text,s.warranty_pct::text,
 s.retention_cents::text,s.warranty_cents::text,s.net_cents::text,s.currency_code,s.exceeded_at_approval,s.created_at::text`;
const basis=(s:string):bigint=>{const [a,b=""]=s.split("."); return BigInt(a!)*100n+BigInt(b.padEnd(2,"0"));};
export async function listSubStatements(pool:Pool,actor:PurchaseActor,id?:string):Promise<WarehouseResult<unknown[]>> {
  if(!can(actor.roles,"subcontractors.view")) return subDenied;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const rows=await client.query(`SELECT ${fields} FROM public.subcontractor_statements s JOIN public.subcontractor_contracts c ON c.company_id=s.company_id AND c.id=s.contract_id
      WHERE s.company_id=$1 AND ($2::boolean OR c.project_id=ANY($3::text[])) AND ($4::text IS NULL OR s.id=$4) ORDER BY s.created_at DESC,s.id LIMIT 500`,
    [actor.companyId,actor.scope==="COMPANY",actor.scope==="PROJECTS" ? actor.projectIds ?? [] : [],id ?? null]);
    return {outcome:"OK",data:rows.rows};
  });
}
export async function getSubStatement(pool:Pool,actor:PurchaseActor,id:string):Promise<WarehouseResult<{statement:unknown;items:unknown[]}>> {
  const listed=await listSubStatements(pool,actor,id); if(listed.outcome!=="OK") return listed;
  if(!listed.data[0]) return {outcome:"NOT_FOUND",message:"Situacija ne postoji."};
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const items=await client.query("SELECT id,description,amount_cents::text FROM public.subcontractor_statement_items WHERE company_id=$1 AND statement_id=$2 ORDER BY id",[actor.companyId,id]);
    return {outcome:"OK",data:{statement:listed.data[0],items:items.rows}};
  });
}
export async function createSubStatement(pool:Pool,actor:PurchaseActor,input:SubcontractStatementInput):Promise<WarehouseResult<{id:string}>> {
  if(!can(actor.roles,"subcontractors.manage")) return subDenied;
  if(input.periodTo<input.periodFrom || !input.statementNo.trim() || input.items.some(i=>!i.description.trim())) return {outcome:"VALIDATION_FAILED",message:"Podaci situacije nisu validni."};
  const gross=input.items.reduce((s,i)=>s+BigInt(i.amountCents),0n);
  if(gross>9223372036854775807n) return {outcome:"VALIDATION_FAILED",message:"Vrijednost situacije je prevelika."};
  const hash=subHash(input);
  return withCompany(pool,companyId(actor.companyId),async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('sub-statement:' || $1 || ':' || $2,0))",[actor.companyId,input.clientGeneratedId]);
    const contract=await subContract(client,actor,input.contractId,true); if(!contract) return subMissing;
    const existing=await client.query<{id:string;request_hash:string}>("SELECT id,request_hash FROM public.subcontractor_statements WHERE company_id=$1 AND client_generated_id=$2",[actor.companyId,input.clientGeneratedId]);
    if(existing.rows[0]) return existing.rows[0].request_hash===hash ? {outcome:"OK",data:{id:existing.rows[0].id}} : {outcome:"CONFLICT",message:"Identifikator je već korišten."};
    if(contract.status!=="ACTIVE") return {outcome:"CONFLICT",message:"Situacija zahtijeva aktivan ugovor."};
    if(input.phaseId) {
      const phase=await client.query("SELECT id FROM public.project_phases WHERE company_id=$1 AND project_id=$2 AND id=$3",[actor.companyId,contract.project_id,input.phaseId]);
      if(!phase.rowCount) return {outcome:"VALIDATION_FAILED",message:"Faza ne pripada projektu."};
    }
    let amounts:ReturnType<typeof subcontractorStatementAmounts>;
    try {amounts=subcontractorStatementAmounts(gross,basis(contract.retention_pct),basis(contract.warranty_pct));}
    catch {return {outcome:"VALIDATION_FAILED",message:"Zaokruženi odbici premašuju bruto iznos."};}
    const id=subId("scs");
    const inserted=await client.query(`INSERT INTO public.subcontractor_statements(id,company_id,contract_id,phase_id,period_from,period_to,statement_no,status,gross_cents,retention_pct,warranty_pct,retention_cents,warranty_cents,net_cents,currency_code,created_by,client_generated_id,request_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'SUBMITTED',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(company_id,contract_id,statement_no) DO NOTHING RETURNING id`,
    [id,actor.companyId,input.contractId,input.phaseId ?? null,input.periodFrom,input.periodTo,input.statementNo.trim(),gross.toString(),contract.retention_pct,contract.warranty_pct,amounts.retentionCents.toString(),amounts.warrantyCents.toString(),amounts.netCents.toString(),contract.currency_code,actor.userId,input.clientGeneratedId,hash]);
    if(!inserted.rowCount) return {outcome:"CONFLICT",message:"Broj situacije već postoji za ugovor."};
    for(const i of input.items) await client.query("INSERT INTO public.subcontractor_statement_items(id,company_id,statement_id,description,amount_cents) VALUES ($1,$2,$3,$4,$5)",[subId("scsi"),actor.companyId,id,i.description.trim(),i.amountCents]);
    await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action:"subcontract.statement_created",entityType:"subcontractor_statement",entityId:id,retentionClass:"FINANCIAL",metadata:{contractId:contract.id,grossCents:gross.toString()}});
    return {outcome:"OK",data:{id}};
  });
}
export async function approveSubStatement(pool:Pool,actor:PurchaseActor,id:string):Promise<WarehouseResult<{id:string;status:string;warnings:string[];alreadyApproved:boolean}>> {
  if(!can(actor.roles,"subcontractors.manage")) return subDenied;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const ref=await client.query<{contract_id:string}>("SELECT contract_id FROM public.subcontractor_statements WHERE company_id=$1 AND id=$2",[actor.companyId,id]);
    if(!ref.rows[0]) return {outcome:"NOT_FOUND",message:"Situacija ne postoji."};
    const contract=await subContract(client,actor,ref.rows[0].contract_id,true); if(!contract) return subMissing;
    const result=await client.query<{status:string;gross_cents:string;phase_id:string|null;period_to:string;currency_code:string;exceeded_at_approval:boolean}>("SELECT status,gross_cents::text,phase_id,period_to::text,currency_code,exceeded_at_approval FROM public.subcontractor_statements WHERE company_id=$1 AND id=$2 FOR UPDATE",[actor.companyId,id]);
    const statement=result.rows[0]!;
    if(statement.status==='APPROVED' || statement.status==='PAID') return {outcome:"OK",data:{id,status:statement.status,warnings:statement.exceeded_at_approval ? ["SUBCONTRACTOR_CONTRACT_EXCEEDED"] : [],alreadyApproved:true}};
    if(contract.status!=='ACTIVE' || statement.status!=='SUBMITTED') return {outcome:"CONFLICT",message:"Situacija ili ugovor nisu aktivni za odobrenje."};
    if(!isCurrency(statement.currency_code)) return {outcome:"VALIDATION_FAILED",message:"Valuta nije podržana."};
    const totals=await client.query<{approved:string;amendments:string}>(`SELECT COALESCE((SELECT sum(gross_cents) FROM public.subcontractor_statements WHERE company_id=$1 AND contract_id=$2 AND status IN ('APPROVED','PAID')),0)::text AS approved,
      COALESCE((SELECT sum(value_amendment_cents) FROM public.subcontractor_contract_amendments WHERE company_id=$1 AND contract_id=$2),0)::text AS amendments`,[actor.companyId,contract.id]);
    const exceeded=subcontractorContractExceeded(BigInt(totals.rows[0]!.approved),BigInt(statement.gross_cents),BigInt(contract.contract_value_cents)+BigInt(totals.rows[0]!.amendments));
    await client.query("UPDATE public.subcontractor_statements SET status='APPROVED',exceeded_at_approval=$3,updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,id,exceeded]);
    await ensureCostCategories(client,actor.companyId,actor.userId);
    const category=await client.query<{id:string}>("SELECT id FROM public.cost_categories WHERE company_id=$1 AND code='PODIZVOĐAČI' AND is_active",[actor.companyId]);
    if(!category.rows[0]) throw Error("COST_CATEGORY_MISSING");
    await postCost(client,{companyId:actor.companyId,projectId:contract.project_id,phaseId:statement.phase_id,categoryId:category.rows[0].id,sourceType:"SUBCONTRACTOR",sourceId:id,occurredOn:statement.period_to,amountCents:BigInt(statement.gross_cents),currency:statement.currency_code,actorId:actor.userId});
    const warnings=exceeded ? ["SUBCONTRACTOR_CONTRACT_EXCEEDED"] : [];
    await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action:"subcontract.statement_approved",entityType:"subcontractor_statement",entityId:id,retentionClass:"FINANCIAL",metadata:{warnings,grossCents:statement.gross_cents}});
    return {outcome:"OK",data:{id,status:"APPROVED",warnings,alreadyApproved:false}};
  });
}

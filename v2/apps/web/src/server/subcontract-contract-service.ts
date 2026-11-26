import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId, withCompany } from "@gradix/db";
import type { SubcontractAmendInput, SubcontractContractInput, SubcontractContractPatch } from "@gradix/contracts";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import { canUsePurchaseProject, type PurchaseActor } from "./purchase-request-service";
import type { WarehouseResult } from "./warehouse-service";

export const subId=(p:string)=>`${p}_${randomUUID().replace(/-/g,"")}`;
export const subHash=(x:unknown)=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
export const subDenied={outcome:"FORBIDDEN",message:"Nemate pravo upravljanja podizvođačima."} as const;
export const subMissing={outcome:"NOT_FOUND",message:"Ugovor ne postoji."} as const;
export type Contract={id:string;project_id:string;partner_id:string;status:string;currency_code:string;retention_pct:string;warranty_pct:string;contract_value_cents:string};
export async function subContract(client:PoolClient,actor:PurchaseActor,id:string,lock=false):Promise<Contract|null> {
  const rows=await client.query<Contract>(`SELECT id,project_id,partner_id,status,currency_code,retention_pct::text,warranty_pct::text,contract_value_cents::text
    FROM public.subcontractor_contracts WHERE company_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,[actor.companyId,id]);
  const row=rows.rows[0]; return row && canUsePurchaseProject(actor,row.project_id) ? row : null;
}
const fields=`c.id,c.project_id,c.partner_id,c.code,c.title,c.scope,c.contract_value_cents::text,c.currency_code,c.retention_pct::text,c.warranty_pct::text,
 c.valid_from::text,c.valid_to::text,c.status,c.document_attachment_id,c.created_at::text,
 COALESCE((SELECT sum(a.value_amendment_cents) FROM public.subcontractor_contract_amendments a WHERE a.company_id=c.company_id AND a.contract_id=c.id),0)::text AS amendment_cents`;
export async function listSubContracts(pool:Pool,actor:PurchaseActor,id?:string):Promise<WarehouseResult<unknown[]>> {
  if(!can(actor.roles,"subcontractors.view")) return subDenied;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const rows=await client.query(`SELECT ${fields} FROM public.subcontractor_contracts c WHERE c.company_id=$1
      AND ($2::boolean OR c.project_id=ANY($3::text[])) AND ($4::text IS NULL OR c.id=$4) ORDER BY c.created_at DESC,c.id LIMIT 500`,
    [actor.companyId,actor.scope==="COMPANY",actor.scope==="PROJECTS" ? actor.projectIds ?? [] : [],id ?? null]);
    return {outcome:"OK",data:rows.rows};
  });
}
export async function createSubContract(pool:Pool,actor:PurchaseActor,input:SubcontractContractInput):Promise<WarehouseResult<{id:string}>> {
  if(!can(actor.roles,"subcontractors.manage") || !canUsePurchaseProject(actor,input.projectId)) return subDenied;
  if(!input.code.trim() || !input.title.trim() || Number(input.retentionPct)+Number(input.warrantyPct)>100 || (input.validFrom && input.validTo && input.validTo<input.validFrom)) return {outcome:"VALIDATION_FAILED",message:"Podaci ugovora nisu validni."};
  const hash=subHash(input);
  return withCompany(pool,companyId(actor.companyId),async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('sub-contract:' || $1 || ':' || $2,0))",[actor.companyId,input.clientGeneratedId]);
    const existing=await client.query<{id:string;project_id:string;request_hash:string}>("SELECT id,project_id,request_hash FROM public.subcontractor_contracts WHERE company_id=$1 AND client_generated_id=$2",[actor.companyId,input.clientGeneratedId]);
    if(existing.rows[0]) {
      if(!canUsePurchaseProject(actor,existing.rows[0].project_id)) return subDenied;
      return existing.rows[0].request_hash===hash ? {outcome:"OK",data:{id:existing.rows[0].id}} : {outcome:"CONFLICT",message:"Identifikator je već korišten."};
    }
    const refs=await client.query<{ok:boolean}>(`SELECT EXISTS(SELECT 1 FROM public.projects WHERE company_id=$1 AND id=$2 AND status<>'FINISHED')
      AND EXISTS(SELECT 1 FROM public.partners p JOIN public.partner_roles r ON r.company_id=p.company_id AND r.partner_id=p.id WHERE p.company_id=$1 AND p.id=$3 AND p.active AND r.role='SUBCONTRACTOR' AND r.is_active)
      AND EXISTS(SELECT 1 FROM public.companies WHERE id=$1 AND currency=$4)
      AND ($5::text IS NULL OR EXISTS(SELECT 1 FROM public.attachments WHERE company_id=$1 AND id=$5 AND status='ready')) AS ok`,
    [actor.companyId,input.projectId,input.partnerId,input.currencyCode,input.documentAttachmentId ?? null]);
    if(!refs.rows[0]?.ok) return {outcome:"VALIDATION_FAILED",message:"Projekat, podizvođač, valuta ili prilog nisu validni."};
    const id=subId("scc");
    const inserted=await client.query(`INSERT INTO public.subcontractor_contracts(id,company_id,project_id,partner_id,code,title,scope,contract_value_cents,currency_code,retention_pct,warranty_pct,valid_from,valid_to,document_attachment_id,created_by,client_generated_id,request_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(company_id,code) DO NOTHING RETURNING id`,
    [id,actor.companyId,input.projectId,input.partnerId,input.code.trim(),input.title.trim(),input.scope?.trim() || null,input.contractValueCents,input.currencyCode,input.retentionPct,input.warrantyPct,input.validFrom ?? null,input.validTo ?? null,input.documentAttachmentId ?? null,actor.userId,input.clientGeneratedId,hash]);
    if(!inserted.rowCount) return {outcome:"CONFLICT",message:"Šifra ugovora već postoji."};
    await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action:"subcontract.contract_created",entityType:"subcontractor_contract",entityId:id,retentionClass:"FINANCIAL",metadata:{projectId:input.projectId,partnerId:input.partnerId}});
    return {outcome:"OK",data:{id}};
  });
}
export async function patchSubContract(pool:Pool,actor:PurchaseActor,id:string,input:SubcontractContractPatch):Promise<WarehouseResult<{id:string;status:string}>> {
  if(!can(actor.roles,"subcontractors.manage")) return subDenied;
  return withCompany(pool,companyId(actor.companyId),async client=>{
    const contract=await subContract(client,actor,id,true); if(!contract) return subMissing;
    if(!((contract.status==='DRAFT' && input.status==='ACTIVE') || (contract.status==='ACTIVE' && ['COMPLETED','TERMINATED'].includes(input.status)))) return {outcome:"CONFLICT",message:"Promjena statusa nije dozvoljena."};
    await client.query("UPDATE public.subcontractor_contracts SET status=$3,updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,id,input.status]);
    await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action:"subcontract.contract_updated",entityType:"subcontractor_contract",entityId:id,retentionClass:"FINANCIAL",metadata:{status:input.status}});
    return {outcome:"OK",data:{id,status:input.status}};
  });
}
export async function amendSubContract(pool:Pool,actor:PurchaseActor,id:string,input:SubcontractAmendInput):Promise<WarehouseResult<{id:string}>> {
  if(!can(actor.roles,"subcontractors.manage")) return subDenied;
  if(BigInt(input.valueAmendmentCents)<=0n || input.reason.trim().length<10) return {outcome:"VALIDATION_FAILED",message:"Aneks zahtijeva pozitivan iznos i razlog."};
  const hash=subHash({id,...input});
  return withCompany(pool,companyId(actor.companyId),async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('sub-amend:' || $1 || ':' || $2,0))",[actor.companyId,input.clientGeneratedId]);
    const contract=await subContract(client,actor,id,true); if(!contract) return subMissing;
    const old=await client.query<{id:string;request_hash:string}>("SELECT id,request_hash FROM public.subcontractor_contract_amendments WHERE company_id=$1 AND client_generated_id=$2",[actor.companyId,input.clientGeneratedId]);
    if(old.rows[0]) return old.rows[0].request_hash===hash ? {outcome:"OK",data:{id:old.rows[0].id}} : {outcome:"CONFLICT",message:"Identifikator je već korišten."};
    if(contract.status!=='ACTIVE') return {outcome:"CONFLICT",message:"Aneks je moguć samo za aktivan ugovor."};
    const amount=await client.query<{sum:string}>("SELECT COALESCE(sum(value_amendment_cents),0)::text AS sum FROM public.subcontractor_contract_amendments WHERE company_id=$1 AND contract_id=$2",[actor.companyId,id]);
    if(BigInt(contract.contract_value_cents)+BigInt(amount.rows[0]!.sum)+BigInt(input.valueAmendmentCents)>9223372036854775807n) return {outcome:"VALIDATION_FAILED",message:"Vrijednost ugovora prelazi dozvoljeni opseg."};
    const aid=subId("sca");
    await client.query("INSERT INTO public.subcontractor_contract_amendments(id,company_id,contract_id,value_amendment_cents,reason,created_by,client_generated_id,request_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",[aid,actor.companyId,id,input.valueAmendmentCents,input.reason.trim(),actor.userId,input.clientGeneratedId,hash]);
    await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action:"subcontract.contract_amended",entityType:"subcontractor_contract",entityId:id,retentionClass:"FINANCIAL",metadata:{amendmentId:aid,valueCents:input.valueAmendmentCents,reason:input.reason.trim()}});
    return {outcome:"OK",data:{id:aid}};
  });
}

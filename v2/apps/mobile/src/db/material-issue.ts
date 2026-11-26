import { MaterialIssueInput, type MaterialIssueInput as IssueInput } from "@gradix/contracts";
import type { LocalSqlite } from "./migrations";
import { LocalAccountScopeError, LocalOutboxError, type LocalAccount } from "./r4-outbox";

export type MaterialCatalog={projects:{id:string;code:string;name:string}[];warehouses:{id:string;name:string;project_id:string}[];items:{id:string;code:string;name:string;unit:string}[];phases:Record<string,{id:string;name:string}[]>};
export type MaterialRow={localId:string;payload:IssueInput;status:"pending"|"failed"|"rejected"|"sent";error:string|null;serverId:string|null;createdAt:string};
async function assertAccount(db:LocalSqlite,account:LocalAccount) {
  const row=await db.getFirstAsync<{company_id:string;user_id:string}>("SELECT company_id,user_id FROM active_account WHERE singleton=1");
  if(row?.company_id!==account.companyId || row.user_id!==account.userId) throw new LocalAccountScopeError();
}
export async function writeMaterialCatalog(db:LocalSqlite,account:LocalAccount,catalog:MaterialCatalog,fetchedAt=new Date().toISOString()) {
  await db.withTransactionAsync(async()=>{await assertAccount(db,account);await db.runAsync(`INSERT INTO material_issue_catalog(company_id,user_id,payload_json,fetched_at) VALUES (?,?,?,?)
    ON CONFLICT(company_id,user_id) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=excluded.fetched_at`,[account.companyId,account.userId,JSON.stringify(catalog),fetchedAt]);});
}
export async function readMaterialCatalog(db:LocalSqlite,account:LocalAccount):Promise<{catalog:MaterialCatalog;fetchedAt:string}|null> {
  await assertAccount(db,account);const row=await db.getFirstAsync<{payload_json:string;fetched_at:string}>("SELECT payload_json,fetched_at FROM material_issue_catalog WHERE company_id=? AND user_id=?",[account.companyId,account.userId]);
  return row ? {catalog:JSON.parse(row.payload_json) as MaterialCatalog,fetchedAt:row.fetched_at} : null;
}
export async function queueMaterialIssue(db:LocalSqlite,account:LocalAccount,input:IssueInput) {
  const result=MaterialIssueInput.safeParse(input);
  if(!result.success || result.data.items.some(item=>!/[1-9]/.test(item.quantity))) throw new LocalOutboxError("MATERIAL_INVALID","Provjerite projekat, skladište, artikal i količinu.");
  const payload=JSON.stringify(result.data),now=new Date().toISOString();
  await db.withTransactionAsync(async()=>{await assertAccount(db,account);
    const existing=await db.getFirstAsync<{payload_json:string}>("SELECT payload_json FROM material_issue_outbox WHERE company_id=? AND user_id=? AND local_id=?",[account.companyId,account.userId,result.data.clientGeneratedId]);
    if(existing) {if(existing.payload_json!==payload)throw new LocalOutboxError("OUTBOX_LOCAL_ID_REUSED","ID izlaza je već korišten.");return;}
    await db.runAsync(`INSERT INTO material_issue_outbox(company_id,user_id,local_id,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?)`,[account.companyId,account.userId,result.data.clientGeneratedId,payload,now,now]);
  });
}
export async function readMaterialIssues(db:LocalSqlite,account:LocalAccount):Promise<MaterialRow[]> {
  await assertAccount(db,account);
  const rows=await db.getAllAsync<{local_id:string;payload_json:string;status:MaterialRow["status"];last_error:string|null;server_id:string|null;created_at:string}>(`SELECT local_id,payload_json,status,last_error,server_id,created_at FROM material_issue_outbox WHERE company_id=? AND user_id=? ORDER BY created_at DESC,local_id`,[account.companyId,account.userId]);
  return rows.map(r=>({localId:r.local_id,payload:JSON.parse(r.payload_json) as IssueInput,status:r.status,error:r.last_error,serverId:r.server_id,createdAt:r.created_at}));
}
export async function markMaterialIssue(db:LocalSqlite,account:LocalAccount,id:string,status:"sent"|"failed"|"rejected",error:string|null,serverId:string|null) {
  await db.withTransactionAsync(async()=>{await assertAccount(db,account);await db.runAsync(`UPDATE material_issue_outbox SET status=?,last_error=?,server_id=?,attempts=attempts+1,updated_at=?
    WHERE company_id=? AND user_id=? AND local_id=? AND status IN ('pending','failed')`,[status,error,serverId,new Date().toISOString(),account.companyId,account.userId,id]);});
}

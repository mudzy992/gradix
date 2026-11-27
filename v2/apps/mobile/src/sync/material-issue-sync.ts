import type { MaterialIssueInput } from "@gradix/contracts";
import type { LocalSqlite } from "../db/migrations";
import type { LocalAccount } from "../db/r4-outbox";
import { markMaterialIssue, readMaterialIssues } from "../db/material-issue";

type Sender=(account:LocalAccount,input:MaterialIssueInput)=>Promise<{id:string}>;
export async function syncMaterialIssues(db:LocalSqlite,account:LocalAccount,send:Sender):Promise<{applied:number;retry:number;rejected:number}> {
  const outcome={applied:0,retry:0,rejected:0};
  const rows=await readMaterialIssues(db,account);
  for(const row of rows.reverse()) {
    if(row.status!=="pending" && row.status!=="failed")continue;
    try {
      const result=await send(account,row.payload);
      await markMaterialIssue(db,account,row.localId,"sent",null,result.id);outcome.applied++;
    } catch(error) {
      const status=typeof error==="object" && error!==null && "status" in error ? Number(error.status) : 0;
      const code=typeof error==="object" && error!==null && "code" in error ? String(error.code) : "NETWORK_ERROR";
      const safe=/^[A-Z0-9_]{1,80}$/.test(code) ? code : "NETWORK_ERROR";
      const retry=status===0 || status===401 || status===429 || status>=500 || safe==="AUTH_REQUIRED" || safe==="STOCK_COUNT_IN_PROGRESS" || safe==="LOCAL_ACCOUNT_SCOPE_MISMATCH";
      await markMaterialIssue(db,account,row.localId,retry ? "failed" : "rejected",safe,null);
      if(retry){outcome.retry++;break;}else outcome.rejected++;
    }
  }
  return outcome;
}

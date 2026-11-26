"use client";
import { useRef, useState } from "react";
import { apiCall, jsonBody } from "@/api-client";

/** Ne mijenjaj zahtjev nakon nepoznatog ishoda: ponavlja se tačno isti sadržaj i UUID. */
export function usePurchasePost(onDone:(message:string)=>Promise<void>) {
  const payload=useRef<Record<string,unknown>|null>(null);
  const sending=useRef(false);
  const [locked,setLocked]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  async function post(url:string,body:Record<string,unknown>,message:string) {
    if(sending.current) return;
    sending.current=true;setBusy(true);setError(null);
    payload.current ??= body;
    setLocked(true);
    const result=await apiCall<{warnings?:string[]}>(url,jsonBody(payload.current));
    if(!result.ok) {
      if(result.code === "VALIDATION_FAILED" || result.code === "FORBIDDEN" || result.code === "NOT_FOUND") {
        payload.current=null;setLocked(false);setError(result.message);
      } else {
        setError(`${result.message} Ponovite s istim podacima; prije novog unosa provjerite postojeće dokumente.`);
      }
    } else {
      payload.current=null;setLocked(false);
      const warnings=result.data.warnings ?? [];
      await onDone(warnings.includes("PURCHASE_INVOICE_MISMATCH") ? `${message} PURCHASE_INVOICE_MISMATCH: račun se ne slaže s prijemom.` : warnings.length ? `${message} Upozorenje: ${warnings.join(", ")}` : message);
    }
    sending.current=false;setBusy(false);
  }
  return {post,locked,busy,error};
}

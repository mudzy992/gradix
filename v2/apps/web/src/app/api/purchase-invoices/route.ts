import type { NextRequest } from "next/server";
import { PurchaseInvoiceInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { createPurchaseInvoice,listPurchaseInvoices } from "@/server/purchase-invoice-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest):Promise<Response> {
  try { const a=await guard(request,"purchase.view"); if(!a.ok) return a.response;
    const result=await listPurchaseInvoices(await getVerifiedPool(),a.ctx);
    return purchaseResponse(result.outcome==="OK" ? {outcome:"OK",data:{invoices:result.data}} : result);
  } catch(error) { return internal(error,"purchase.invoices.list"); }
}
export async function POST(request:NextRequest):Promise<Response> {
  try { const a=await guard(request,"purchase.manage"); if(!a.ok) return a.response;
    const parsed=PurchaseInvoiceInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) return fail("VALIDATION_FAILED","Račun nije validan.");
    return purchaseResponse(await createPurchaseInvoice(await getVerifiedPool(),a.ctx,parsed.data));
  } catch(error) { return internal(error,"purchase.invoices.create"); }
}

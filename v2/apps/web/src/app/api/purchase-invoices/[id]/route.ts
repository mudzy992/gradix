import type { NextRequest } from "next/server";
import { PurchaseInvoicePatchInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { getPurchaseInvoice,patchPurchaseInvoice } from "@/server/purchase-invoice-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function GET(request:NextRequest,{params}:Context):Promise<Response> {
  try { const a=await guard(request,"purchase.view"); if(!a.ok) return a.response;
    return purchaseResponse(await getPurchaseInvoice(await getVerifiedPool(),a.ctx,(await params).id));
  } catch(error) { return internal(error,"purchase.invoices.detail"); }
}
export async function PATCH(request:NextRequest,{params}:Context):Promise<Response> {
  try { const a=await guard(request,"purchase.manage"); if(!a.ok) return a.response;
    const parsed=PurchaseInvoicePatchInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) return fail("VALIDATION_FAILED","Račun nije validan.");
    return purchaseResponse(await patchPurchaseInvoice(await getVerifiedPool(),a.ctx,(await params).id,parsed.data));
  } catch(error) { return internal(error,"purchase.invoices.patch"); }
}

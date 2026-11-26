import type { NextRequest } from "next/server";
import { GoodsReceiptInput } from "@gradix/contracts";
import { fail,internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { receiveGoods } from "@/server/goods-receipt-service";
import { purchaseResponse } from "@/server/purchase-response";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest):Promise<Response> {
  try { const a=await guard(request,"purchase.manage"); if(!a.ok) return a.response;
    const parsed=GoodsReceiptInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) return fail("VALIDATION_FAILED","Prijem nije validan.");
    return purchaseResponse(await receiveGoods(await getVerifiedPool(),a.ctx,parsed.data));
  } catch(error) { return internal(error,"purchase.receipts.create"); }
}

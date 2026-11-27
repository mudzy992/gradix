import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { MaterialIssuesResponse, GoodsReceiptsResponse, PurchaseRequestsResponse } from "@gradix/contracts";
import { listMaterialIssues, listGoodsReceipts } from "./phase-10b-list-service";
import { createPurchaseRequest, getPurchaseRequest, listPurchaseRequests, patchPurchaseRequest, transitionPurchaseRequest, type PurchaseActor } from "./purchase-request-service";
import { createPurchaseOrder, getPurchaseOrder, sendPurchaseOrder } from "./purchase-order-service";
import { receiveGoods } from "./goods-receipt-service";
import { approvePurchaseInvoice, createPurchaseInvoice } from "./purchase-invoice-service";
import { issueMaterial } from "./material-issue-service";

const adminUrl=process.env.DATABASE_ADMIN_URL, appUrl=process.env.DATABASE_URL;
const describeDb=adminUrl && appUrl ? describe : describe.skip;
const run=randomUUID().replace(/-/g,"");
const company=`pco_${run}`, other=`pother_${run}`, user=`pu_${run}`, project=`ppr_${run}`, item=`pit_${run}`, partner=`pp_${run}`;
const owner:PurchaseActor={companyId:company,userId:user,roles:["OWNER"],scope:"COMPANY",projectIds:null};
const manager:PurchaseActor={...owner,roles:["PROJECT_MANAGER"],scope:"PROJECTS",projectIds:[project]};

describeDb("F10A-2 zahtjevi nabavke",()=>{
  const admin=new Pool({connectionString:adminUrl}),app=new Pool({connectionString:appUrl});
  beforeAll(async()=>{
    await admin.query("INSERT INTO companies(id,name,slug) VALUES ($1,'A',$1),($2,'B',$2)",[company,other]);
    await admin.query("INSERT INTO users(id,email,first_name,last_name,password_hash) VALUES ($1,$2,'A','B','x')",[user,`${user}@test.example`]);
    await withCompany(admin,companyId(company),async client=>{
      await client.query("INSERT INTO projects(id,company_id,code,name,status) VALUES ($1,$2,'P','Projekt','ACTIVE')",[project,company]);
      await client.query("INSERT INTO stock_items(id,company_id,code,name,unit,created_by,updated_by) VALUES ($1,$2,'I','Artikal','kom',$3,$3)",[item,company,user]);
      await client.query("INSERT INTO partners(id,company_id,code,name,kind) VALUES ($1,$2,'V','Dobavljač','VENDOR')",[partner,company]);
    });
  });
  afterAll(async()=>{
    await withCompany(admin,companyId(company),async client=>{
      await client.query("SET LOCAL session_replication_role=replica");
      for(const table of ["approval_requests","material_issue_allocations","cost_entries","material_issue_items","material_issues","purchase_invoice_items","purchase_invoices","goods_receipt_items","goods_receipts","purchase_order_items","purchase_orders","purchase_request_items","purchase_requests","stock_movements","stock_items","partner_roles","partners","projects","audit_events"]) await client.query(`DELETE FROM ${table} WHERE company_id=$1`,[company]);
    });
    await admin.query("DELETE FROM companies WHERE id=ANY($1)",[[company,other]]);
    await admin.query("DELETE FROM users WHERE id=$1",[user]);
    await app.end(); await admin.end();
  });
  const input=(price:string)=>({clientGeneratedId:randomUUID(),projectId:project,justification:"Materijal za projekat",currencyCode:"BAM" as const,items:[{itemId:item,description:"Artikal",unit:"kom",quantity:"1",estimatedUnitPriceCents:price}]});
  it("iznad praga traži odobrenje vlasnika, a prag je snimljen pri predaji",async()=>{
    const created=await createPurchaseRequest(app,manager,input("100001"));
    expect(created.outcome).toBe("OK"); if(created.outcome!=="OK") return;
    const id=created.data.id;
    expect(await transitionPurchaseRequest(app,manager,id,"submit")).toMatchObject({outcome:"OK",data:{approvalRequired:true}});
    const submitted=await listPurchaseRequests(app,manager);
    if(submitted.outcome!=="OK") throw Error(submitted.message);
    expect(PurchaseRequestsResponse.safeParse({requests:submitted.data}).success).toBe(true);
    expect(submitted.data).toContainEqual(expect.objectContaining({id,approval_threshold_cents:"100000"}));
    await admin.query("UPDATE companies SET purchase_approval_threshold_cents=200000 WHERE id=$1",[company]);
    expect((await transitionPurchaseRequest(app,manager,id,"approve")).outcome).toBe("FORBIDDEN");
    expect((await transitionPurchaseRequest(app,owner,id,"approve")).outcome).toBe("OK");
    const result=await withCompany(admin,companyId(company),client=>client.query<{status:string}>("SELECT status FROM approval_requests WHERE company_id=$1 AND subject_type='purchase' AND subject_id=$2",[company,id]));
    expect(result.rows[0]?.status).toBe("APPROVED");
    expect((await patchPurchaseRequest(app,owner,id,{justification:"Promjena"})).outcome).toBe("CONFLICT");
    await admin.query("UPDATE companies SET purchase_approval_threshold_cents=100000 WHERE id=$1",[company]);
  });
  it("na pragu odobrava PM; drugi tenant i nedodijeljeni projekat su izolovani",async()=>{
    const created=await createPurchaseRequest(app,manager,input("100000"));
    expect(created.outcome).toBe("OK"); if(created.outcome!=="OK") return;
    expect((await transitionPurchaseRequest(app,manager,created.data.id,"submit")).outcome).toBe("OK");
    expect((await transitionPurchaseRequest(app,manager,created.data.id,"approve")).outcome).toBe("OK");
    expect((await getPurchaseRequest(app,{...owner,companyId:other},created.data.id)).outcome).toBe("NOT_FOUND");
    expect((await getPurchaseRequest(app,{...manager,projectIds:[]},created.data.id)).outcome).toBe("NOT_FOUND");
    expect((await createPurchaseRequest(app,{...manager,projectIds:[]},input("1"))).outcome).toBe("FORBIDDEN");
    const listed=await listPurchaseRequests(app,{...manager,projectIds:[]});
    expect(listed).toMatchObject({outcome:"OK",data:[]});
  });
  it("narudžbenica od neodobrenog zahtjeva je odbijena, parcijalni prijemi pune IN ledger",async()=>{
    const draftInput=input("1000");
    const draft=await createPurchaseRequest(app,owner,draftInput); if(draft.outcome!=="OK") throw Error(draft.message);
    expect(await createPurchaseRequest(app,owner,draftInput)).toEqual(draft);
    expect((await createPurchaseRequest(app,owner,{...draftInput,justification:"Drugačije"})).outcome).toBe("CONFLICT");
    const orderInput={clientGeneratedId:randomUUID(),requestId:draft.data.id,partnerId:partner,currencyCode:"BAM" as const,items:[{itemId:item,description:"Artikal",unit:"kom",quantity:"10",unitPriceCents:"125"}]};
    expect((await createPurchaseOrder(app,owner,orderInput)).outcome).toBe("CONFLICT");
    await transitionPurchaseRequest(app,owner,draft.data.id,"submit"); await transitionPurchaseRequest(app,owner,draft.data.id,"approve");
    const order=await createPurchaseOrder(app,owner,orderInput); if(order.outcome!=="OK") throw Error(order.message);
    expect((await sendPurchaseOrder(app,owner,order.data.id)).outcome).toBe("OK");
    expect(await createPurchaseOrder(app,owner,orderInput)).toEqual(order);
    const detail=await getPurchaseOrder(app,owner,order.data.id); if(detail.outcome!=="OK") throw Error(detail.message);
    const line=(detail.data.items[0] as {id:string}).id;
    const central=await withCompany(admin,companyId(company),client=>client.query<{id:string}>("SELECT id FROM warehouses WHERE company_id=$1 AND kind='CENTRAL'",[company]));
    const base={orderId:order.data.id,partnerId:partner,warehouseId:central.rows[0]!.id,receivedAt:"2026-11-23T12:00:00Z",currencyCode:"BAM" as const};
    const firstInput={...base,clientGeneratedId:randomUUID(),items:[{orderItemId:line,itemId:item,quantity:"4",unitPriceCents:"125"}]};
    const first=await receiveGoods(app,owner,firstInput);
    expect(first).toMatchObject({outcome:"OK",data:{orderStatus:"PARTIALLY_RECEIVED",warnings:[]}});
    const receipts=await listGoodsReceipts(app,manager);
    expect(receipts.outcome).toBe("OK");
    if(receipts.outcome==="OK") {
      expect(GoodsReceiptsResponse.safeParse({receipts:receipts.data}).success).toBe(true);
      expect(receipts.data).toContainEqual(expect.objectContaining({item_name:"Artikal",quantity:"4.000"}));
    }
    expect(await listGoodsReceipts(app,{...manager,projectIds:[]})).toMatchObject({outcome:"OK",data:[]});
    expect(await listGoodsReceipts(app,{...owner,companyId:other})).toMatchObject({outcome:"OK",data:[]});
    expect((await listGoodsReceipts(app,{...owner,roles:["WORKER"]})).outcome).toBe("FORBIDDEN");
    expect(await receiveGoods(app,owner,firstInput)).toEqual(first);
    expect((await receiveGoods(app,owner,{...firstInput,items:[{orderItemId:line,itemId:item,quantity:"3",unitPriceCents:"125"}]})).outcome).toBe("CONFLICT");
    const second=await receiveGoods(app,owner,{...base,clientGeneratedId:randomUUID(),items:[{orderItemId:line,itemId:item,quantity:"6",unitPriceCents:"125"}]});
    expect(second).toMatchObject({outcome:"OK",data:{orderStatus:"RECEIVED"}});
    expect(await receiveGoods(app,owner,firstInput)).toEqual(first);
    const ledger=await withCompany(admin,companyId(company),client=>client.query<{qty:string;amount:string}>("SELECT sum(quantity)::text qty,sum(amount_cents)::text amount FROM stock_movements WHERE company_id=$1 AND item_id=$2 AND source_type='PURCHASE'",[company,item]));
    expect(ledger.rows[0]).toEqual({qty:"10.000",amount:"1250"});
    const emergency=await receiveGoods(app,owner,{...base,clientGeneratedId:randomUUID(),orderId:null,note:"Hitna kupovina",items:[{itemId:item,quantity:"1",unitPriceCents:"125"}]});
    expect(emergency).toMatchObject({outcome:"OK",data:{warnings:["RECEIPT_WITHOUT_ORDER"]}});
    if(emergency.outcome!=="OK") return;
    const receipt=await withCompany(admin,companyId(company),client=>client.query<{id:string}>("SELECT id FROM goods_receipt_items WHERE company_id=$1 AND receipt_id=$2",[company,emergency.data.id]));
    const invoiceInput={partnerId:partner,invoiceNumber:"INV-1",invoiceDate:"2026-11-23",amountCents:"126",currencyCode:"BAM" as const,projectId:project,
      items:[{receiptItemId:receipt.rows[0]!.id,quantity:"1",amountCents:"126"}]};
    const invoice=await createPurchaseInvoice(app,owner,invoiceInput);
    expect(invoice).toMatchObject({outcome:"OK",data:{warnings:["PURCHASE_INVOICE_MISMATCH"]}});
    expect(await createPurchaseInvoice(app,owner,invoiceInput)).toMatchObject({outcome:"CONFLICT",code:"INVOICE_ALREADY_REGISTERED"});
    if(invoice.outcome!=="OK") return;
    expect(await approvePurchaseInvoice(app,owner,invoice.data.id)).toMatchObject({outcome:"OK",data:{alreadyApproved:false}});
    expect(await approvePurchaseInvoice(app,owner,invoice.data.id)).toMatchObject({outcome:"OK",data:{alreadyApproved:true}});
    const issue={clientGeneratedId:randomUUID(),warehouseId:central.rows[0]!.id,projectId:project,issuedAt:"2026-11-23T12:00:00Z",items:[{itemId:item,quantity:"0.5"}]};
    const issued=await issueMaterial(app,owner,issue);
    expect(issued).toMatchObject({outcome:"OK",data:{amountCents:"63",offsetCents:"63"}});
    expect(await issueMaterial(app,owner,issue)).toEqual(issued);
    const visible=await listMaterialIssues(app,manager);
    expect(visible.outcome).toBe("OK");
    if(visible.outcome==="OK") {
      expect(MaterialIssuesResponse.safeParse({issues:visible.data}).success).toBe(true);
      expect(visible.data).toContainEqual(expect.objectContaining({project_id:project,amount_cents:"63"}));
    }
    expect(await listMaterialIssues(app,{...manager,projectIds:[]})).toMatchObject({outcome:"OK",data:[]});
    expect(await listMaterialIssues(app,{...owner,companyId:other})).toMatchObject({outcome:"OK",data:[]});
    expect((await listMaterialIssues(app,{...owner,roles:["WORKER"]})).outcome).toBe("FORBIDDEN");
    expect((await issueMaterial(app,owner,{...issue,items:[{itemId:item,quantity:"0.6"}]})).outcome).toBe("CONFLICT");
    expect(await issueMaterial(app,owner,{...issue,clientGeneratedId:randomUUID()})).toMatchObject({outcome:"OK",data:{amountCents:"63",offsetCents:"63"}});
    const costs=await withCompany(admin,companyId(company),client=>client.query<{kind:string;amount:string}>("SELECT entry_kind AS kind,amount_cents::text AS amount FROM cost_entries WHERE company_id=$1 AND project_id=$2 AND source_type='PURCHASE' AND status='POSTED' ORDER BY amount_cents DESC",[company,project]));
    expect(costs.rows).toEqual([{kind:"CHARGE",amount:"126"},{kind:"CHARGE",amount:"63"},{kind:"CHARGE",amount:"63"},{kind:"OFFSET",amount:"-63"},{kind:"OFFSET",amount:"-63"}]);
    expect(costs.rows.reduce((sum,r)=>sum+BigInt(r.amount),0n)).toBe(126n);
    await withCompany(admin,companyId(company),async client=>{
      await client.query("SAVEPOINT immutable");
      await expect(client.query("UPDATE cost_entries SET amount_cents=0 WHERE company_id=$1 AND supplier_invoice_id=$2 AND entry_kind='OFFSET'",[company,invoice.data.id])).rejects.toThrow(/IMMUTABLE/);
      await client.query("ROLLBACK TO SAVEPOINT immutable");
    });
    // Izlaz se može dogoditi prije računa: odobrenje naknadno dodaje OFFSET.
    const early=await issueMaterial(app,owner,{...issue,clientGeneratedId:randomUUID(),items:[{itemId:item,quantity:"1"}]});
    expect(early).toMatchObject({outcome:"OK",data:{amountCents:"125",offsetCents:"0"}});
    if(first.outcome!=="OK") throw Error(first.message);
    const firstLine=await withCompany(admin,companyId(company),client=>client.query<{id:string}>("SELECT id FROM goods_receipt_items WHERE company_id=$1 AND receipt_id=$2",[company,first.data.id]));
    const late=await createPurchaseInvoice(app,owner,{...invoiceInput,invoiceNumber:"INV-LATE",amountCents:"125",orderId:order.data.id,items:[{receiptItemId:firstLine.rows[0]!.id,quantity:"1",amountCents:"125"}]});
    if(late.outcome!=="OK") throw Error(late.message);
    expect((await approvePurchaseInvoice(app,owner,late.data.id)).outcome).toBe("OK");
    const offsets=await withCompany(admin,companyId(company),client=>client.query<{sum:string}>("SELECT COALESCE(sum(amount_cents),0)::text AS sum FROM cost_entries WHERE company_id=$1 AND supplier_invoice_id=$2 AND entry_kind='OFFSET'",[company,late.data.id]));
    expect(offsets.rows[0]!.sum).toBe("-125");
    const overhead=await issueMaterial(app,owner,{...issue,clientGeneratedId:randomUUID(),projectId:null,items:[{itemId:item,quantity:"1"}]});
    expect(overhead).toMatchObject({outcome:"OK",data:{amountCents:"125",offsetCents:"0"}});
    if(overhead.outcome!=="OK") throw Error(overhead.message);
    const overheadCost=await withCompany(admin,companyId(company),client=>client.query("SELECT 1 FROM cost_entries WHERE company_id=$1 AND source_id=$2 AND entry_kind='OVERHEAD' AND project_id IS NULL AND amount_cents=125",[company,overhead.data.id]));
    expect(overheadCost.rowCount).toBe(1);
    const concurrent={...issue,clientGeneratedId:randomUUID(),items:[{itemId:item,quantity:"1"}]};
    const [left,right]=await Promise.all([issueMaterial(app,owner,concurrent),issueMaterial(app,owner,concurrent)]);
    expect(left.outcome).toBe("OK"); expect(right).toEqual(left);
    const unique=await withCompany(admin,companyId(company),client=>client.query("SELECT id FROM material_issues WHERE company_id=$1 AND client_generated_id=$2",[company,concurrent.clientGeneratedId]));
    expect(unique.rowCount).toBe(1);
  });
  it("konkurentni izlazi iz iste zalihe ne knjiže više od dostupnog",async()=>{
    const raceItem=`race_item_${run}`;
    const warehouse=await withCompany(admin,companyId(company),async client=>{
      const row=await client.query<{id:string}>("SELECT id FROM public.warehouses WHERE company_id=$1 AND kind='CENTRAL'",[company]);
      await client.query("INSERT INTO public.stock_items(id,company_id,code,name,unit,created_by,updated_by) VALUES($1,$2,'RACE','Race','kom',$3,$3)",[raceItem,company,user]);
      await client.query("INSERT INTO public.stock_movements(id,company_id,item_id,warehouse_id,kind,quantity,unit_cost_cents,occurred_on,created_by) VALUES($1,$2,$3,$4,'IN',10,101,current_date,$5)",[ `race_in_${run}`,company,raceItem,row.rows[0]!.id,user]);
      return row.rows[0]!.id;
    });
    const input={warehouseId:warehouse,projectId:project,issuedAt:"2026-11-23T12:00:00Z",items:[{itemId:raceItem,quantity:"7"}]};
    const results=await Promise.all([issueMaterial(app,owner,{...input,clientGeneratedId:randomUUID()}),issueMaterial(app,owner,{...input,clientGeneratedId:randomUUID()})]);
    const ok=results.filter(r=>r.outcome==="OK"); expect(ok).toHaveLength(1);
    if(ok[0]?.outcome!=="OK") throw Error("issue failed");
    expect(ok[0].data.amountCents).toBe("707");
    const row=await admin.query<{balance:string;cost:string}>(`SELECT
      (SELECT sum(CASE WHEN kind='IN' THEN quantity WHEN kind='OUT' THEN -quantity ELSE 0 END)::text FROM public.stock_movements WHERE company_id=$1 AND item_id=$2) AS balance,
      (SELECT amount_cents::text FROM public.cost_entries WHERE company_id=$1 AND source_type='PURCHASE' AND source_id=$3) AS cost`,[company,raceItem,ok[0].data.id]);
    expect(row.rows[0]).toEqual({balance:"3.000",cost:"707"});
  });
  it("nema predaje bez ovlasti, niti pozitivne stavke od nule",async()=>{
    expect((await createPurchaseRequest(app,{...owner,roles:["ACCOUNTANT"]},input("10"))).outcome).toBe("FORBIDDEN");
    expect((await createPurchaseRequest(app,owner,{...input("10"),items:[{...input("10").items[0]!,quantity:"0"}]})).outcome).toBe("VALIDATION_FAILED");
  });
});

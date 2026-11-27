import { chooseSelect } from "@/test/select-field";
// @vitest-environment jsdom
import { render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,describe,expect,it,vi } from "vitest";
import { InvoiceForm,OrderForm,ReceiptForm } from "./purchase-forms";
import type { Options } from "./purchase-types";

const options:Options={
  items:[],projects:[],partners:[{id:"partner",name:"Dobavljač",code:"D",kind:"VENDOR",active:true,note:null}],
  warehouses:[{id:"w",code:"W",name:"Skladište",kind:"CENTRAL",project_id:null,address:null,is_active:true}],
  requests:[{id:"r",project_id:null,phase_id:null,requested_by_worker_id:null,needed_by:null,justification:"Cement",status:"APPROVED",total_estimated_cents:"100",currency_code:"BAM",approval_threshold_cents:"100000",created_by:"u",created_at:"2026-01-01"}],
  orders:[{id:"o",request_id:"r",partner_id:"partner",ordered_at:null,expected_at:null,status:"SENT",total_cents:"100",currency_code:"BAM",created_at:"2026-01-01"}],
  receipts:[{id:"receipt",item_id:"receipt-item",stock_item_id:"i",order_id:"o",partner_id:"partner",warehouse_id:"w",received_at:"2026-01-01",currency_code:"BAM",note:null,item_name:"Cement",unit:"kg",quantity:"2",amount_cents:"200"}],
};
afterEach(()=>vi.unstubAllGlobals());
function mockApi(){
  const fetch=vi.fn(async(url:string,_init?:RequestInit)=>{
    const data=url==="/api/purchase-requests/r" ? {request:options.requests[0],items:[{id:"ri",item_id:"i",description:"Cement",unit:"kg",quantity:"2",estimated_unit_price_cents:"100"}]}
      : url==="/api/purchase-orders/o" ? {order:options.orders[0],items:[{id:"oi",request_item_id:"ri",item_id:"i",description:"Cement",unit:"kg",quantity:"2",unit_price_cents:"100",received_quantity:"0"}]}
      : {id:"new",warnings:url==="/api/purchase-invoices" ? ["PURCHASE_INVOICE_MISMATCH"] : []};
    return {ok:true,json:async()=>({success:true,data}),headers:{get:()=>null}};
  });vi.stubGlobal("fetch",fetch);return fetch;
}
describe("Obrasci nabavke",()=>{
  it("narudžbenica povezuje odobrenu stavku i dobavljača",async()=>{
    const fetch=mockApi();const done=vi.fn();const user=userEvent.setup();render(<OrderForm options={options} onDone={done}/>);
    await chooseSelect(user, screen.getByLabelText("Odobreni zahtjev"),"r");

    await chooseSelect(user, screen.getByLabelText("Stavka zahtjeva"),"ri");await chooseSelect(user, screen.getByLabelText("Dobavljač narudžbenice"),"partner");
    await user.type(screen.getByLabelText("Količina narudžbe"),"2");await user.type(screen.getByLabelText("Cijena po jedinici (feninga)"),"100");
    await user.click(screen.getByRole("button",{name:"Sačuvaj narudžbenicu"}));await waitFor(()=>expect(done).toHaveBeenCalled());
    const call=fetch.mock.calls.find(([url,init])=>url==="/api/purchase-orders" && init?.method==="POST");
    expect(JSON.parse(call![1]!.body as string)).toMatchObject({requestId:"r",partnerId:"partner",items:[{requestItemId:"ri",itemId:"i",quantity:"2",unitPriceCents:"100"}]});
  });
  it("prijem upućuje na stvarnu stavku narudžbenice",async()=>{
    const fetch=mockApi();const done=vi.fn();const user=userEvent.setup();render(<ReceiptForm options={options} onDone={done} initialWarehouse="w"/>);
    await chooseSelect(user, screen.getByLabelText("Poslana narudžbenica"),"o");
    await chooseSelect(user, screen.getByLabelText("Stavka narudžbenice"),"oi");await user.type(screen.getByLabelText("Količina prijema"),"2");await user.type(screen.getByLabelText("Cijena prijema (feninga po jedinici)"),"100");
    await user.click(screen.getByRole("button",{name:"Evidentiraj prijem"}));await waitFor(()=>expect(done).toHaveBeenCalled());
    const call=fetch.mock.calls.find(([url])=>url==="/api/goods-receipts");expect(JSON.parse(call![1]!.body as string)).toMatchObject({orderId:"o",partnerId:"partner",warehouseId:"w",items:[{orderItemId:"oi",itemId:"i",quantity:"2"}]});
  });
  it("račun povezuje stavku prijema i prikazuje mismatch",async()=>{
    const fetch=mockApi();const done=vi.fn();const user=userEvent.setup();render(<InvoiceForm options={options} onDone={done}/>);
    await chooseSelect(user, screen.getByLabelText("Stavka prijema za račun"),"receipt-item");await user.type(screen.getByLabelText("Broj računa"),"R-1");
    await user.type(screen.getByLabelText("Količina na računu"),"2");await user.type(screen.getByLabelText("Iznos računa (feninga)"),"201");
    await user.click(screen.getByRole("button",{name:"Evidentiraj račun"}));await waitFor(()=>expect(done).toHaveBeenCalledWith(expect.stringContaining("Račun se ne slaže")));
    const call=fetch.mock.calls.find(([url])=>url==="/api/purchase-invoices");expect(JSON.parse(call![1]!.body as string)).toMatchObject({partnerId:"partner",amountCents:"201",items:[{receiptItemId:"receipt-item",quantity:"2",amountCents:"201"}]});
  });
});

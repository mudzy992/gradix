// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FuelEntriesClient } from "./fuel-entries-client";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/api-client",()=>({apiCall:async (url:string)=>({ok:true,data:url === "/api/equipment" ? {machines:[{id:"m 1",code:"M",name:"Bager"}]} : {}}),jsonBody:vi.fn()}));
vi.mock("./deviations-panel",()=>({DeviationsPanel:()=>null}));
vi.mock("./fuel-tanks-panel",()=>({FuelPricesPanel:()=>null,FuelTanksPanel:()=>null}));
const caps={canExport:true,canCreate:false,canRevise:false,showPrice:false,canManageFuel:false,tankEnabled:false,tanks:[]};
describe("izvoz goriva",()=>{
  it("veza nosi odabrani filter mašine",async()=>{
    render(<FuelEntriesClient initialEntries={[]} caps={caps} />);
    expect(screen.getByRole("link",{name:"Preuzmi CSV prikazanih unosa"})).toHaveAttribute("href","/api/fuel-entries/export");
    await userEvent.selectOptions(await screen.findByLabelText("Mašina"),"m 1");
    expect(screen.getByRole("link",{name:"Preuzmi CSV prikazanih unosa"})).toHaveAttribute("href","/api/fuel-entries/export?machineId=m%201");
  });
  it("bez dozvole ne nudi izvoz",()=>{
    render(<FuelEntriesClient initialEntries={[]} caps={{...caps,canExport:false}} />);
    expect(screen.queryByRole("link",{name:"Preuzmi CSV prikazanih unosa"})).toBeNull();
  });
});

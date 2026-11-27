// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { apiCall } from "@/api-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { CommandPalette } from "./shell-palette";
vi.mock("@/api-client",()=>({apiCall:vi.fn()}));

describe("globalna pretraga",()=>{
  it("debounce, grupisani server rezultati, strelice, Enter i pristupačnost",async()=>{
    vi.mocked(apiCall).mockResolvedValue({ok:true,data:{results:[
      {type:"PROJECT",title:"Most",href:"/ured/projekti/p1"},{type:"WORKER",title:"Mosta",href:"/ured/radnici/w1"},
    ]}});
    const navigate=vi.fn(); const close=vi.fn();
    const {container}=render(<CommandPalette items={[]} onClose={close} onNavigate={navigate} />);
    const input=screen.getByRole("combobox"); expect(input).toHaveFocus();
    await userEvent.type(input,"most");
    expect(await screen.findByRole("option",{name:"Most"})).toBeTruthy();
    expect(apiCall).toHaveBeenCalledWith("/api/search?q=most",expect.objectContaining({signal:expect.any(AbortSignal)}));
    expect(screen.getByRole("group",{name:"Projekti"})).toBeTruthy();
    expect(screen.getByRole("group",{name:"Radnici"})).toBeTruthy();
    await expectNoSeriousA11yViolations(container);
    await userEvent.tab(); expect(screen.getByRole("button",{name:"Zatvori pretragu"})).toHaveFocus();
    await userEvent.tab(); expect(input).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{Enter}"); expect(navigate).toHaveBeenCalledWith("/ured/radnici/w1");
    await userEvent.keyboard("{Escape}");expect(close).toHaveBeenCalledOnce();
  });
  it("grešku ne prikazuje kao praznu uspješnu pretragu",async()=>{
    vi.mocked(apiCall).mockResolvedValue({ok:false,message:"error"});
    render(<CommandPalette items={[]} onClose={()=>{}} onNavigate={()=>{}} />);
    await userEvent.type(screen.getByRole("combobox"),"abc");
    expect(await screen.findByText("Pretraga podataka trenutno nije dostupna.")).toBeTruthy();
  });
});

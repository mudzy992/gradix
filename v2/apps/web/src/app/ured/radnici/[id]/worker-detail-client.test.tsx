// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { WorkerDetailClient } from "./worker-detail-client";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));

const worker = {id:"w",firstName:"Amina",middleName:null,lastName:"Test",phone:null,email:null,jobTitle:null,engagement:"PERMANENT",hiredAt:"2026-01-01",endedAt:null,team:null,supervisorId:null,supervisorName:null,userId:null,isActive:true,educationLevel:null,profession:null,drivingCategories:[],shoeSize:null,clothingSize:null,photoObjectKey:null,notes:null,sensitive:null};
const caps = {canManage:true,canSeePayroll:false,canManagePayroll:false,canSeeSensitive:false,canSeeRates:true,canManageRates:true,canManageLeave:true,canManageIssuances:true};

describe("Kartica radnika — tabovi",()=>{
  it("čuva dijaloge, dostupnost i dozvole",async()=>{
    const user=userEvent.setup();
    const {container}=render(<WorkerDetailClient worker={worker} caps={caps} rates={{rates:[],current:null}} leave={[]} issuances={{issuances:[],activeCount:0}} history={[]} />);
    expect(screen.getByRole("heading",{name:"Amina Test"})).toBeTruthy();
    expect(screen.queryByRole("tab",{name:"Obračun"})).toBeNull();
    await user.click(screen.getByRole("tab",{name:"Godišnji odmor"}));
    expect(screen.getByText("Saldo nije upisan")).toBeTruthy();
    await user.click(screen.getByRole("button",{name:"Upiši pravo"}));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab",{name:"Zaduženja"}));
    expect(screen.getByText("Nema zaduženja")).toBeTruthy();
    await expectNoSeriousA11yViolations(container);
  });
});

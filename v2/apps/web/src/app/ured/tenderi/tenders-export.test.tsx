// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { TendersClient } from "./tenders-client";
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
const caps={canExport:true,canManage:false,canConvert:false,canPrice:false,canApprovePrice:false,canOutcome:false};
describe("izvoz tendera",()=>{
  it("povezuje status i hitnost s izvozom i prolazi axe",async()=>{
    const {container}=render(<TendersClient initialTenders={[]} caps={caps} />);
    await userEvent.selectOptions(screen.getByLabelText("Status"),"PREPARATION");
    await userEvent.click(screen.getByLabelText("Samo hitni (14 dana)"));
    expect(screen.getByRole("link",{name:"Preuzmi CSV prikazanih tendera"})).toHaveAttribute("href","/api/tenders/export?status=PREPARATION&urgent=1");
    await expectNoSeriousA11yViolations(container);
  });
  it("bez izvozne dozvole ne nudi link",()=>{
    render(<TendersClient initialTenders={[]} caps={{...caps,canExport:false}} />);
    expect(screen.queryByRole("link",{name:"Preuzmi CSV prikazanih tendera"})).toBeNull();
  });
});

// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { ServisClient } from "./servis-client";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
describe("dashboard filter servisnih naloga",()=>{
  it("jasno označava filter i omogućava povratak; axe",async()=>{
    const {container}=render(<ServisClient initialOrders={[]} dashboardFilter="waiting" caps={{canManage:false,canApprove:false}}/>);
    expect(screen.getByText(/Moji nalozi koji čekaju dijelove/)).toBeVisible();
    expect(screen.getByRole("link",{name:"Prikaži sve naloge"})).toHaveAttribute("href","/ured/servis");
    await expectNoSeriousA11yViolations(container);
  });
});

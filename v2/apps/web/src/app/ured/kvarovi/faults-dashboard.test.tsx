// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { FaultsClient } from "./faults-client";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/api-client",()=>({apiCall:vi.fn().mockResolvedValue({ok:true,data:{machines:[],partners:[]}})}));
describe("dashboard filter kvarova",()=>{
  it("označava dodijeljene projekte i dozvoljava izlaz; axe",async()=>{
    const {container}=render(<FaultsClient initialFaults={[]} dashboardFiltered caps={{canCreate:false,canRevise:false,canApprove:false}}/>);
    expect(screen.getByText(/Otvoreni kvarovi · dodijeljeni projekti/)).toBeVisible();
    expect(screen.getByRole("link",{name:"Prikaži sve kvarove"})).toHaveAttribute("href","/ured/kvarovi");
    await expectNoSeriousA11yViolations(container);
  });
});

// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { apiCall } from "@/api-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { ProjectTasks } from "./project-tasks";
vi.mock("@/api-client",()=>({apiCall:vi.fn(),jsonBody:vi.fn(),patchBody:vi.fn()}));
describe("dashboard filter zadataka",()=>{
  it("kasne i dodijeljene projekte šalje serveru, filter se može ukloniti; axe",async()=>{
    vi.mocked(apiCall).mockResolvedValue({ok:true,data:{tasks:[],counts:{mine_today:0,open:0,overdue:0}}});
    const {container}=render(<ProjectTasks canManage={false} initialDashboardFilter="kasni" />);
    expect(await screen.findByText(/Zadaci koji kasne · dodijeljeni projekti/)).toBeTruthy();
    expect(apiCall).toHaveBeenCalledWith("/api/tasks?assignedProjects=1&open=1&due=OVERDUE");
    await expectNoSeriousA11yViolations(container);
    await userEvent.click(screen.getByRole("button",{name:"Prikaži sve zadatke"}));
    expect(apiCall).toHaveBeenCalledWith("/api/tasks?");
  });
});

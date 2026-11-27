// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiCall } from "@/api-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { ReportsClient } from "./reports-client";
vi.mock("@/api-client",()=>({apiCall:vi.fn(),jsonBody:(value:unknown)=>({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(value)})}));
const jobs={jobs:[{id:"j1",key:"HSE",format:"pdf",from:"2026-01-01",to:"2026-01-31",status:"DONE",createdAt:"2026-01-01T12:00:00Z",completedAt:"2026-01-01T12:00:00Z",error:null}]};
describe("izvještaji",()=>{
  beforeEach(()=>vi.mocked(apiCall).mockReset());
  it("forma i statusi, POST s periodom i formatom; axe",async()=>{
    vi.mocked(apiCall).mockImplementation(async (url,init)=>({ok:true,data:init?.method === "POST" ? jobs.jobs[0] : url === "/api/projects" ? {projects:[]} : jobs}) as never);
    const {container}=render(<ReportsClient keys={["HSE","FUEL"]} canExport canSeeProjects />);
    expect(await screen.findByText(/Spremno/)).toBeTruthy();
    expect(screen.getByRole("button",{name:"Preuzmi PDF"})).toBeTruthy();
    expect(screen.getByLabelText("Tim")).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Izvještaj"),"FUEL");
    await userEvent.type(screen.getByLabelText("Tim"),"Sjever");
    await userEvent.selectOptions(screen.getByLabelText("Format"),"xlsx");
    await userEvent.click(screen.getByRole("button",{name:"Pošalji na obradu"}));
    await waitFor(()=>expect(apiCall).toHaveBeenCalledWith("/api/report-jobs",expect.objectContaining({method:"POST",body:expect.stringContaining('"team":"Sjever"')})));
    expect(await screen.findByText(/poslan na obradu/)).toBeTruthy();
    await expectNoSeriousA11yViolations(container);
  });
  it("bez prava izvoza ne nudi radnje",async()=>{
    vi.mocked(apiCall).mockResolvedValue({ok:true,data:{jobs:[]}});
    render(<ReportsClient keys={["HSE"]} canExport={false} canSeeProjects={false} />);
    expect(screen.getByText("Nemate pravo izvoza podataka.")).toBeTruthy();
    expect(screen.queryByRole("button",{name:"Pošalji na obradu"})).toBeNull();
    expect(await screen.findByText("Još nema poslova.")).toBeTruthy();
  });
});

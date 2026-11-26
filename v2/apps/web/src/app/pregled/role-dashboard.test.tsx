// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiCall } from "@/api-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { RoleDashboard } from "./role-dashboard";
vi.mock("@/api-client",()=>({apiCall:vi.fn()}));

const dashboard={checkedAt:"2026-11-23T12:00:00Z",items:[
  {key:"risky_projects",role:"OWNER",count:2,href:"/ured/projekti",priority:1},
  {key:"overdue_tasks",role:"PROJECT_MANAGER",count:3,href:"/ured/zadaci",priority:1},
  {key:"unsigned_diaries",role:"SITE_SUPERVISOR",count:1,href:"/ured/dnevnik",priority:2},
  {key:"pending_costs",role:"ACCOUNTANT",count:4,href:"/ured/projekti",priority:2},
  {key:"waiting_parts",role:"MECHANIC",count:1,href:"/ured/servis",priority:1},
  {key:"my_orders",role:"MECHANIC",count:0,href:"/ured/servis",priority:2},
],projectFinancials:[],topMachines:[]};
const health={items:[{key:"unconfirmed_days",count:2,href:"/ured/radni-dani"},
  {key:"projects_without_budget",count:1,href:"/ured/projekti"},
  {key:"machines_without_rate",count:1,href:"/ured/masine"},
  {key:"workers_without_rate",count:1,href:"/ured/radnici"},
  {key:"warehouses_without_minimum",count:1,href:"/ured/skladiste"},
  {key:"incidents_without_actions",count:1,href:"/ured/hse"}]};

describe("role dashboard i data health",()=>{
  beforeEach(()=>vi.mocked(apiCall).mockReset());
  it("prikazuje samo nenulte akcije za dostavljene role i svih šest stavki zdravlja", async()=>{
    vi.mocked(apiCall).mockImplementation(async url=>({ok:true,data:url === "/api/dashboard" ? dashboard : health}) as never);
    const {container}=render(<RoleDashboard canViewActions canViewHealth />);
    expect(await screen.findByRole("link",{name:/Rizični projekti/})).toHaveAttribute("href","/ured/projekti");
    for (const label of ["Zadaci koji kasne","Dnevnici bez potpisa","Troškovi bez cijene","Nalozi koji čekaju dijelove",
      "Dani bez potvrde","Projekti bez budžeta","Mašine bez stope","Radnici bez satnice","Skladišta bez minimuma","Incidenti bez mjera"])
      expect(screen.getByRole("link",{name:new RegExp(label)})).toBeTruthy();
    expect(screen.queryByText("Moji servisni nalozi")).toBeNull();
    await expectNoSeriousA11yViolations(container);
  });
  it("ne traži panel za korisnika bez prava i ne prikazuje lažnu nulu kod greške", async()=>{
    vi.mocked(apiCall).mockResolvedValue({ok:false,message:"greška"});
    render(<RoleDashboard canViewActions canViewHealth={false} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("nisu dostupne");
    expect(apiCall).not.toHaveBeenCalledWith("/api/data-health");
    expect(screen.queryByText(/Sve pod kontrolom/)).toBeNull();
  });
  it("u praznom stanju prikazuje vrijeme provjere", async()=>{
    vi.mocked(apiCall).mockResolvedValue({ok:true,data:{...dashboard,items:[]}});
    render(<RoleDashboard canViewActions canViewHealth={false} />);
    expect(await screen.findByText(/Sve pod kontrolom · zadnja provjera/)).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { navModulesForRoles } from "./nav";
import { activeModule, ModuleNavigation, ModuleTabs } from "./module-nav";

describe("UI-1 navigacija modula",()=>{
  it("drži putanje dostupnim, označava najprecizniji tab i prolazi axe",async()=>{
    const modules=navModulesForRoles(["OWNER"],{"/ured/sukobi":{count:3,older:1}});
    const pathname="/ured/masine/kalendar";
    expect(activeModule(modules,pathname)?.module.label).toBe("Mehanizacija");
    const {container}=render(<><ModuleNavigation modules={modules} pathname={pathname} /><ModuleTabs modules={modules} pathname={pathname} /></>);
    expect(screen.getByRole("link",{name:"Mehanizacija"})).toHaveAttribute("aria-current","location");
    expect(screen.getByRole("link",{name:"Zauzetost mašina"})).toHaveAttribute("aria-current","page");
    expect(screen.getByRole("link",{name:"Mašine i vozila"})).toHaveAttribute("href","/ured/masine");
    await expectNoSeriousA11yViolations(container);
  });
  it("podržava navigaciju tastaturom i akcijske stranice ostaju pod pregledom", async () => {
    const modules = navModulesForRoles(["OWNER"]);
    expect(activeModule(modules, "/ured/akcije")?.module.label).toBe("Pregled");
    render(<ModuleNavigation modules={modules} pathname="/pregled" />);
    const links = within(screen.getByRole("navigation", { name: "Glavna navigacija" })).getAllByRole("link");
    links[0]!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(links[1]).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(links[links.length - 1]).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(links[0]).toHaveFocus();
  });
  it("ne nudi zabranjen tab; dostupni podmodul može biti ulaz u modul",()=>{
    const modules=navModulesForRoles(["WORKER"]);
    const items=modules.flatMap(module=>module.items);
    expect(items.some(item=>item.href==="/ured/obracun-sati")).toBe(false);
    for (const module of modules) expect(module.items.length).toBeGreaterThan(0);
  });
});

// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { ActionListView } from "./action-list-view";
describe("filtrirana akciona lista",()=>{
  it("prikazuje zapise, stvarna odredišta i paginaciju; axe",async()=>{
    const {container}=render(<ActionListView actionKey="purchases_for_approval" list={{title:"Nabavke za odobrenje",items:[{id:"p1",label:"Skela",href:"/ured/nabavka"}],page:2,hasNext:true}} />);
    expect(screen.getByRole("heading",{name:"Nabavke za odobrenje"})).toBeVisible();
    expect(screen.getByRole("link",{name:"Skela"})).toHaveAttribute("href","/ured/nabavka");
    expect(screen.getByRole("link",{name:"Prethodna stranica"})).toHaveAttribute("href","/ured/akcije?key=purchases_for_approval&page=1");
    expect(screen.getByRole("link",{name:"Sljedeća stranica"})).toHaveAttribute("href","/ured/akcije?key=purchases_for_approval&page=3");
    await expectNoSeriousA11yViolations(container);
  });
});

// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { HealthList } from "./health-list";

describe("filtrirana lista nedostataka",()=>{
  it("prikazuje tačne zapise, direktno rješenje i paginaciju; axe",async()=>{
    const {container}=render(<HealthList healthKey="machines_without_rate" rows={[{id:"m 1",label:"Bager"}]} page={2} hasMore />);
    expect(screen.getByRole("link",{name:"Bager"})).toHaveAttribute("href","/ured/trosak-masina?masina=m%201");
    expect(screen.getByRole("link",{name:"Prethodna"})).toHaveAttribute("href","/ured/masine?filter=bez-stope&page=1");
    expect(screen.getByRole("link",{name:"Sljedeća"})).toHaveAttribute("href","/ured/masine?filter=bez-stope&page=3");
    expect(screen.getByRole("link",{name:"Prikaži sve"})).toHaveAttribute("href","/ured/masine");
    await expectNoSeriousA11yViolations(container);
  });
});

// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { MasinaOdrzavanjeClient } from "./odrzavanje-client";

describe("Kartica mašine",()=>{
  it("razdvaja planove i historiju i ne izmišlja vrijednosti",async()=>{
    const {container}=render(<MasinaOdrzavanjeClient machineId="m" plans={[]} orders={[]} reliability={{from:"2026-01-01",to:"2026-01-31",faultCount:0,finishedCount:0,mttrMinutes:null,mtbfHours:null,workHours:"0",maintenanceCostAmount:"0",maintenanceCostPerHourAmount:null,currencyCode:"BAM"}} />);
    expect(screen.getByText("Mašina nema plan preventivnog održavanja.")).toBeTruthy();
    expect(screen.getByRole("link",{name:"Otvori planove servisa"})).toHaveAttribute("href","/ured/servis/planovi");
    await userEvent.click(screen.getByRole("tab",{name:"Historija servisa"}));
    expect(screen.getByText("Nema servisnih naloga za ovu mašinu.")).toBeTruthy();
    expect(screen.getByRole("link",{name:"Otvori u radionici"})).toHaveAttribute("href","/ured/servis?machine=m");
    await expectNoSeriousA11yViolations(container);
  });
});

import { chooseSelect } from "@/test/select-field";
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { HseClient } from "./hse-client";
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
const stats={from:"2026-01-01",to:"2026-12-31",workedHours:0,incidents:0,bySeverity:{},byKind:{},nearMisses:0,lostDays:0,ltifr:null,actions:{open:0,overdue:0,onTimeRate:null},trainings:{count:0,toolbox:0,attendees:0},activeProhibition:null};
const caps={canExport:true,canReport:false,canInvestigate:false,canManageTrainings:false};
describe("izvoz incidenata",()=>{
  it("prenosi vrstu i stanje; axe",async()=>{
    const {container}=render(<HseClient initialIncidents={[]} stats={stats} attention={null} today="2026-01-01" caps={caps} />);
    await chooseSelect(userEvent, screen.getByLabelText("Vrsta"),"NEAR_MISS");
    await chooseSelect(userEvent, screen.getByLabelText("Stanje"),"REPORTED");
    expect(screen.getByRole("link",{name:"Preuzmi CSV prikazanih incidenata"})).toHaveAttribute("href","/api/hse/incidents/export?kind=NEAR_MISS&status=REPORTED");
    await expectNoSeriousA11yViolations(container);
  });
});

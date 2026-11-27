import { describe, expect, it } from "vitest";
import { canRunReport, coversGeneratedAccess, intersectReportAccess, type ReportJobAccess } from "./report-job-permissions";

const original: ReportJobAccess={roles:["PROJECT_MANAGER"],scope:"PROJECTS",projectIds:["a","b"]};
const generated={...original,permissions:["reports.view","export.data"] as const};
describe("report job opseg i promijenjene dozvole", () => {
  it("novo pravo ili projekat ne proširuje izvoz; gubitak se odmah primijeni", () => {
    expect(intersectReportAccess(original,{roles:["PROJECT_MANAGER","OWNER"],scope:"PROJECTS",projectIds:["b","c"]}))
      .toEqual({roles:["PROJECT_MANAGER"],scope:"PROJECTS",projectIds:["b"]});
    expect(intersectReportAccess(original,{roles:["OWNER"],scope:"COMPANY",projectIds:null}))
      .toEqual({roles:[],scope:"PROJECTS",projectIds:["a","b"]});
    expect(intersectReportAccess({roles:["OWNER"],scope:"COMPANY",projectIds:null},
      {roles:["OWNER"],scope:"SELF",projectIds:[]})).toEqual({roles:["OWNER"],scope:"SELF",projectIds:[]});
  });
  it("gubitak izvora ili dozvole odbija izvršavanje", () => {
    expect(canRunReport(original,"PROJECT_COSTS")).toBe(true);
    expect(canRunReport({...original,roles:["WORKER"]},"PROJECT_COSTS")).toBe(false);
    expect(canRunReport({...original,roles:[]},"HSE")).toBe(false);
  });
  it("preuzimanje starog fajla odbija gubitak prava ili bilo kojeg projekta", () => {
    expect(coversGeneratedAccess(generated,{roles:["PROJECT_MANAGER","OWNER"],scope:"COMPANY",projectIds:null})).toBe(true);
    expect(coversGeneratedAccess(generated,{roles:["PROJECT_MANAGER"],scope:"PROJECTS",projectIds:["b"]})).toBe(false);
    expect(coversGeneratedAccess(generated,{roles:["OWNER"],scope:"COMPANY",projectIds:null})).toBe(false);
    expect(coversGeneratedAccess({...generated,permissions:["workers.rates.view"]},
      {roles:["PROJECT_MANAGER"],scope:"COMPANY",projectIds:null})).toBe(false);
    expect(coversGeneratedAccess({roles:["OWNER"],scope:"COMPANY",projectIds:null,permissions:["reports.view"]},
      {roles:["OWNER"],scope:"PROJECTS",projectIds:["a"]})).toBe(false);
    expect(coversGeneratedAccess({roles:["OWNER"],scope:"PROJECTS",projectIds:null,permissions:["reports.view"]},
      {roles:["OWNER"],scope:"PROJECTS",projectIds:[]})).toBe(false);
    expect(coversGeneratedAccess({roles:["OWNER"],scope:"PROJECTS",projectIds:null,permissions:["reports.view"]},
      {roles:["OWNER"],scope:"COMPANY",projectIds:null})).toBe(false);
    expect(coversGeneratedAccess({roles:[],scope:"COMPANY",projectIds:null,permissions:["reports.view"]},
      {roles:["OWNER"],scope:"COMPANY",projectIds:null})).toBe(false);
  });
});

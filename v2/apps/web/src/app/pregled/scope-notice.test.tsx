// @vitest-environment jsdom
/**
 * Poruka o spuštenom opsegu — dio G3 koji se lako previdi.
 *
 * Kad osoba više nije ni na jednom projektu, a opseg joj je `PROJECTS`, sve liste su prazne. Prazna
 * lista bez objašnjenja izgleda kao kvar: čovjek zove ured i prijavljuje nešto što radi kako treba.
 * Zato ekran MORA reći šta je i šta dalje — a ne samo prikazati ništa.
 *
 * Test provjerava PORUKU, a ne implementaciju: da postoji, da imenuje opseg, i da ne izgleda kao
 * greška sistema (jer nije — to je stanje koje ured mijenja jednim klikom).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScopeNotice } from "@/components/scope-notice";
import { expectNoSeriousA11yViolations } from "@/test/axe";

describe("pregled — obavještenje o opsegu", () => {
  it("kad nema nijedne dodjele, kaže da liste nisu greška i kome se obratiti", () => {
    render(<ScopeNotice scope="PROJECTS" assignmentCount={0} />);

    const poruka = screen.getByRole("alert");
    expect(poruka.textContent).toContain("dodijeljeni projekti");
    expect(poruka.textContent).toContain("niste dodijeljeni ni na jedan projekat");
    expect(poruka.textContent).toContain("Nije greška");
    expect(poruka.textContent).toContain("uredu");
    // Ne obećava da će se samo popraviti — kaže ko to mijenja.
    expect(poruka.textContent).toContain("dodijeli");
  });

  it("sa dodjelom nema poruke — ne smeta kad sve radi", () => {
    const { container } = render(<ScopeNotice scope="PROJECTS" assignmentCount={2} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("za opseg `COMPANY` ili `SELF` nema poruke — to nije njihova situacija", () => {
    const company = render(<ScopeNotice scope="COMPANY" assignmentCount={0} />);
    expect(screen.queryByRole("alert")).toBeNull();
    company.unmount();

    render(<ScopeNotice scope="SELF" assignmentCount={0} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("poruka nema serious/critical a11y nalaza", async () => {
    const { container } = render(<ScopeNotice scope="PROJECTS" assignmentCount={0} />);
    await expectNoSeriousA11yViolations(container);
  });
});

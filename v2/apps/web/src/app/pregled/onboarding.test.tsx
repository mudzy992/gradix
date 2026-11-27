// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GettingStarted } from "./onboarding";
import { expectNoSeriousA11yViolations } from "@/test/axe";

describe("Početni koraci po ulozi", () => {
  it.each([
    ["OWNER", "/ured/projekti"], ["PROJECT_MANAGER", "/ured/projekti"],
    ["SITE_SUPERVISOR", "/ured/radni-dani"], ["ACCOUNTANT", "/ured/obracun-sati"],
    ["MECHANIC", "/ured/servis"], ["WORKER", "/ured/profil"],
  ])("%s ima tri dostupna koraka", async (role, href) => {
    const { container } = render(<GettingStarted roles={[role]} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", href);
    await expectNoSeriousA11yViolations(container);
  });
});

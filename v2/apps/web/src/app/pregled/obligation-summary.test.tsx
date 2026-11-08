// @vitest-environment jsdom
/**
 * Kartica „Rokovi“ na pregledu (R2b).
 *
 * Ekran ne računa stanje sam — prikazuje brojeve koje vrati server. Test zato provjerava dvije
 * stvari koje kapija traži (§7.3: broj na početnoj se poklapa sa listom): da se brojevi prikažu
 * onako kako stižu i da prečica vodi na ekran rokova. Kad osoba ne smije vidjeti rokove, kartice
 * NEMA — prazna kutija sa „0“ bi slagala da rokova nema.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ObligationSummary } from "@/components/obligation-summary";
import { expectNoSeriousA11yViolations } from "@/test/axe";

describe("pregled — rokova kartica", () => {
  it("prikazuje isteklo, uskoro i važeće iz brojanja servera", () => {
    render(<ObligationSummary counts={{ expired: 2, expiring: 5, valid: 11 }} />);

    expect(screen.getByRole("heading", { name: "Rokovi" })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("isteklo")).toBeInTheDocument();
    expect(screen.getByText("uskoro istječe")).toBeInTheDocument();
    expect(screen.getByText("važeće")).toBeInTheDocument();
  });

  it("prečica vodi na ekran rokova i ima čitljiv naziv", () => {
    render(<ObligationSummary counts={{ expired: 0, expiring: 0, valid: 0 }} />);

    const link = screen.getByRole("link", { name: "Otvori rokove" });
    expect(link).toHaveAttribute("href", "/ured/rokovi");
  });

  it("nema ozbiljnih a11y prekršaja", async () => {
    const { container } = render(<ObligationSummary counts={{ expired: 1, expiring: 3, valid: 7 }} />);
    await expectNoSeriousA11yViolations(container);
  });
});

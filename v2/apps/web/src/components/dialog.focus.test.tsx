// @vitest-environment jsdom
/**
 * Regresija: tipkanje u drugo polje ne smije vratiti fokus na prvo (onClose inline
 * u roditelju mijenja identity svaki render — Dialog mora fokusirati samo na mount).
 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./dialog";

function ControlledDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  // Inline onClose na svaki render simulira Partneri/Tenderi klijente.
  return (
    <Dialog title="Test" onClose={() => onClose()} trapFocus>
      <label htmlFor="dlg-code">
        Šifra
        <input id="dlg-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <label htmlFor="dlg-name">
        Naziv
        <input id="dlg-name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
    </Dialog>
  );
}

describe("Dialog fokus (Faza 0)", () => {
  it("tipkanje u drugo polje ne vraća fokus na prvo kad se onClose rekreira", async () => {
    const user = userEvent.setup();
    render(<ControlledDialog onClose={vi.fn()} />);

    const code = screen.getByLabelText("Šifra");
    const name = screen.getByLabelText("Naziv");
    expect(code).toHaveFocus();

    await user.click(name);
    expect(name).toHaveFocus();
    await user.type(name, "abc");
    expect(name).toHaveValue("abc");
    expect(name).toHaveFocus();
  });

  it("Tab i Shift+Tab ostaju unutar dijaloga", async () => {
    const user = userEvent.setup();
    render(<ControlledDialog onClose={vi.fn()} />);
    const close = screen.getByRole("button", { name: "Zatvori" });
    const name = screen.getByLabelText("Naziv");
    name.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(name).toHaveFocus();
  });

  it("Escape zatvara dijalog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ControlledDialog onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

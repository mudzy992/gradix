// @vitest-environment jsdom
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { Dialog } from "@/components/dialog";
import { SelectField } from "./select-field";

function Demo({onSubmit=vi.fn()}:{onSubmit?:()=>void}) {
  const [value,setValue]=useState("");
  return <form onSubmit={event=>{event.preventDefault();onSubmit();}}><SelectField label="Skladište" required name="warehouse" value={value} onChange={event=>setValue(event.target.value)} searchThreshold={3}>
    <option value="">Odaberite</option><option value="central">Centralno</option><option value="site">Gradilište</option><option value="disabled" disabled>Neaktivno</option>
  </SelectField><button type="submit">Sačuvaj</button></form>;
}

describe("SelectField",()=>{
  it("ima labelu, tastaturu, pretragu, odabir i validaciju obrasca",async()=>{
    const user=userEvent.setup();const onSubmit=vi.fn();const {container}=render(<Demo onSubmit={onSubmit}/>);
    await user.click(screen.getByRole("button",{name:"Sačuvaj"}));
    expect(onSubmit).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toHaveTextContent("Odaberite vrijednost");
    const select=screen.getByRole("combobox",{name:"Skladište"});expect(select).toHaveFocus();
    await user.keyboard("{ArrowDown}");expect(select).toHaveAttribute("aria-expanded","true");
    await expectNoSeriousA11yViolations(container);
    await user.type(screen.getByRole("searchbox",{name:"Pretraži opcije"}),"Gradilište");
    await user.keyboard("{Enter}");expect(select).toHaveTextContent("Gradilište");
    expect(select).toHaveAttribute("aria-expanded","false");
    expect(new FormData(container.querySelector("form")!).get("warehouse")).toBe("site");
    await user.click(screen.getByRole("button",{name:"Sačuvaj"}));expect(onSubmit).toHaveBeenCalledOnce();
  });
  it("Escape zatvara listu, ne roditeljski dijalog, i vraća fokus",async()=>{
    const onClose=vi.fn();const user=userEvent.setup();render(<Dialog title="Unos" trapFocus onClose={onClose}><Demo/></Dialog>);
    const select=screen.getByRole("combobox",{name:"Skladište"});await user.click(select);
    await user.keyboard("{Escape}");expect(onClose).not.toHaveBeenCalled();expect(select).toHaveFocus();
    await user.keyboard("{Escape}");expect(onClose).toHaveBeenCalledOnce();
  });
  it("odabir bez kontrole čuva vrijednost i preskače onemogućene opcije",async()=>{
    const user=userEvent.setup();render(<SelectField label="Vrsta" defaultValue="a" name="kind"><option value="a">A</option><option value="b" disabled>B</option><option value="c">C</option></SelectField>);
    const select=screen.getByRole("combobox",{name:"Vrsta"});select.focus();await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");expect(select).toHaveTextContent("C");
  });
});

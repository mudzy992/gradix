import { screen, waitFor, within } from "@testing-library/react";
/** Testira stvarnu vidljivu kontrolu; vrijednost koristi samo da pronađe natpis opcije. */
export async function chooseSelect(user:{click:(element:Element)=>Promise<void>}, control:HTMLElement, value:string) {
  const native=control.parentElement?.querySelector("select");
  if(!native) throw new Error("SelectField nema nativni obrazac");
  let label="";
  await waitFor(()=>{
    const option=Array.from(native.options).find(item=>item.value===value);
    if(!option) throw new Error(`Opcija ${value} se još učitava`);
    label=option.textContent?.trim() ?? "";
  });
  await user.click(control);
  await user.click(within(screen.getByRole("listbox")).getByRole("option",{name:label}));
}

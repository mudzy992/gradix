// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiCall } from "@/api-client";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { Passkeys } from "./passkeys";
vi.mock("@/api-client",()=>({apiCall:vi.fn(),jsonBody:(x:unknown)=>({method:"POST",body:JSON.stringify(x)})}));
vi.mock("@simplewebauthn/browser",()=>({browserSupportsWebAuthn:vi.fn(),startRegistration:vi.fn()}));
describe("upravljanje passkeys",()=>{
  beforeEach(()=>{vi.resetAllMocks();vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);});
  it("prikazuje uređaje, datume i brisanje, te prođe axe",async()=>{
    vi.mocked(apiCall).mockResolvedValue({ok:true,data:{passkeys:[{id:"a",deviceName:"MacBook",createdAt:"2026-01-01",lastUsedAt:null}]}} as never);
    const {container}=render(<Passkeys />);expect(await screen.findByText(/MacBook/)).toBeVisible();
    expect(screen.getByText(/dodan:/)).toHaveTextContent("zadnja upotreba: nikad");
    expect(screen.getByRole("button",{name:"Obriši passkey MacBook"})).toBeVisible();
    await expectNoSeriousA11yViolations(container);
  });
  it("bez podrške ostavlja lozinku i ne nudi registraciju",async()=>{
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);vi.mocked(apiCall).mockResolvedValue({ok:true,data:{passkeys:[]}} as never);
    render(<Passkeys />);expect(await screen.findByText(/passkey nije dostupan/)).toBeVisible();expect(screen.getByRole("button",{name:"Dodaj passkey"})).toBeDisabled();
  });
  it("jedan dijalog traži lozinku i 2FA, pa šalje WebAuthn odgovor",async()=>{
    vi.mocked(apiCall).mockImplementation(async url=>({ok:true,data:url.endsWith("status")?{enabled:true}:url.endsWith("options")?{options:{challenge:"test"}}:url.endsWith("verify")?{ok:true}:{passkeys:[]}}) as never);
    vi.mocked(startRegistration).mockResolvedValue({id:"test"} as never);
    const {container}=render(<Passkeys />);
    const trigger=screen.getByRole("button",{name:"Dodaj passkey"});fireEvent.click(trigger);
    const dialog=screen.getByRole("dialog",{name:"Dodaj passkey"});
    expect(within(dialog).getByLabelText("Naziv uređaja")).not.toHaveValue("");
    fireEvent.change(within(dialog).getByLabelText("Naziv uređaja"),{target:{value:"Telefon"}});
    fireEvent.change(within(dialog).getByLabelText("Trenutna lozinka"),{target:{value:"secret"}});
    const totp=await within(dialog).findByLabelText("Kod iz autentikatora");
    fireEvent.change(totp,{target:{value:"123456"}});
    await expectNoSeriousA11yViolations(container);
    fireEvent.click(within(dialog).getByRole("button",{name:"Potvrdi i dodaj passkey"}));
    expect(await screen.findByText("Passkey je registrovan.")).toBeVisible();expect(startRegistration).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

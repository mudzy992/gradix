// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiCall } from "@/api-client";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { Passkeys } from "./passkeys";
vi.mock("@/api-client",()=>({apiCall:vi.fn(),jsonBody:(x:unknown)=>({method:"POST",body:JSON.stringify(x)})}));
vi.mock("@simplewebauthn/browser",()=>({browserSupportsWebAuthn:vi.fn(),startRegistration:vi.fn()}));
describe("upravljanje passkeys",()=>{
  beforeEach(()=>{vi.resetAllMocks();vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);});
  it("prikazuje uređaje, brisanje i prođe axe",async()=>{
    vi.mocked(apiCall).mockResolvedValue({ok:true,data:{passkeys:[{id:"a",deviceName:"MacBook",createdAt:"2026-01-01",lastUsedAt:null}]}} as never);
    const {container}=render(<Passkeys />);expect(await screen.findByText(/MacBook/)).toBeVisible();
    expect(screen.getByRole("button",{name:"Obriši passkey MacBook"})).toBeVisible();
    await expectNoSeriousA11yViolations(container);
  });
  it("bez podrške ostavlja objašnjenje i ne nudi registraciju",async()=>{
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);vi.mocked(apiCall).mockResolvedValue({ok:true,data:{passkeys:[]}} as never);
    render(<Passkeys />);expect(await screen.findByText(/ne podržava WebAuthn/)).toBeVisible();expect(screen.getByRole("button",{name:"Dodaj passkey"})).toBeDisabled();
  });
  it("potvrđuje korisnika i šalje WebAuthn odgovor",async()=>{
    vi.mocked(apiCall).mockImplementation(async url=>({ok:true,data:url.endsWith("options")?{options:{challenge:"test"}}:url.endsWith("verify")?{ok:true}:{passkeys:[]}}) as never);
    vi.mocked(startRegistration).mockResolvedValue({id:"test"} as never);
    render(<Passkeys />);fireEvent.change(screen.getByLabelText("Naziv uređaja"),{target:{value:"Telefon"}});fireEvent.change(screen.getByLabelText("Trenutna lozinka"),{target:{value:"secret"}});fireEvent.click(screen.getByRole("button",{name:"Dodaj passkey"}));
    expect(await screen.findByText("Passkey je registrovan.")).toBeVisible();expect(startRegistration).toHaveBeenCalledOnce();
  });
});

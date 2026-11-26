// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { apiCall } from "@/api-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import LoginPage from "./page";
const router=vi.hoisted(()=>({replace:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>router}));
vi.mock("@simplewebauthn/browser",()=>({browserSupportsWebAuthn:vi.fn(),startAuthentication:vi.fn()}));
vi.mock("@/api-client",()=>({apiCall:vi.fn(),jsonBody:(x:unknown)=>({method:"POST",body:JSON.stringify(x)})}));
describe("prijava passkeyem",()=>{
  beforeEach(()=>vi.resetAllMocks());
  it("nudi lozinku kao fallback i prođe axe",async()=>{
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
    const {container}=render(<LoginPage />);
    expect(screen.getByRole("button",{name:/Prijavi se pomoću Passkey-ja/})).toBeDisabled();
    expect(screen.getByText(/Passkeys nisu dostupni/)).toBeVisible();
    expect(screen.getByRole("button",{name:"Prijavi se"})).toBeEnabled();
    await expectNoSeriousA11yViolations(container);
  });
  it("traži email, ali ne lozinku ni TOTP, te potvrđuje prijavu",async()=>{
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
    vi.mocked(startAuthentication).mockResolvedValue({id:"test"} as never);
    vi.mocked(apiCall).mockImplementation(async url=>({ok:true,data:url.endsWith("options") ? {options:{challenge:"test"}} : {mustChangePassword:false}}) as never);
    render(<LoginPage />);fireEvent.change(screen.getByLabelText("Email"),{target:{value:"user@example.test"}});
    fireEvent.click(screen.getByRole("button",{name:/Prijavi se pomoću Passkey-ja/}));
    await vi.waitFor(()=>expect(router.replace).toHaveBeenCalledWith("/pregled"));
    expect(startAuthentication).toHaveBeenCalledOnce();expect(apiCall).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(apiCall).mock.calls)).not.toContain("password");
  });
});

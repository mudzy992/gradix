// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication } from "@simplewebauthn/browser";
import { apiCall } from "@/api-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import LoginPage from "./page";
const router=vi.hoisted(()=>({replace:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>router}));
vi.mock("@simplewebauthn/browser",()=>({browserSupportsWebAuthn:vi.fn(),browserSupportsWebAuthnAutofill:vi.fn(),startAuthentication:vi.fn(),WebAuthnAbortService:{cancelCeremony:vi.fn()}}));
vi.mock("@/api-client",()=>({apiCall:vi.fn(),jsonBody:(x:unknown)=>({method:"POST",body:JSON.stringify(x)})}));
describe("prijava passkeyem",()=>{
  beforeEach(()=>{vi.resetAllMocks();vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false);});
  it("nudi lozinku kao fallback i prođe axe",async()=>{
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
    const {container}=render(<LoginPage />);
    expect(screen.getByRole("button",{name:/Prijavi se pomoću Passkey-ja/})).toBeDisabled();
    expect(screen.getByText(/Passkeys nisu dostupni/)).toBeVisible();
    expect(screen.getByRole("button",{name:"Prijavi se"})).toBeEnabled();
    await expectNoSeriousA11yViolations(container);
  });
  it.each(["", "user@example.test"])("eksplicitna prijava sa ili bez emaila: %s",async email=>{
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
    vi.mocked(startAuthentication).mockResolvedValue({id:"test"} as never);
    vi.mocked(apiCall).mockImplementation(async url=>({ok:true,data:url.endsWith("options") ? {options:{challenge:"test"}} : {mustChangePassword:false}}) as never);
    render(<LoginPage />);if(email) fireEvent.change(screen.getByLabelText("Email"),{target:{value:email}});
    fireEvent.click(screen.getByRole("button",{name:/Prijavi se pomoću Passkey-ja/}));
    await waitFor(()=>expect(router.replace).toHaveBeenCalledWith("/pregled"));
    expect(startAuthentication).toHaveBeenCalledOnce();expect(apiCall).toHaveBeenCalledTimes(2);
    const options=JSON.parse(String(vi.mocked(apiCall).mock.calls[0]?.[1]?.body));
    expect(options).toEqual(email ? {email} : {});
    expect(JSON.stringify(vi.mocked(apiCall).mock.calls)).not.toContain("password");
  });
  it("podržani browser pokreće conditional autofill bez emaila",async()=>{
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(true);
    vi.mocked(startAuthentication).mockResolvedValue({id:"test"} as never);
    vi.mocked(apiCall).mockImplementation(async url=>({ok:true,data:url.endsWith("options") ? {options:{challenge:"test"}} : {mustChangePassword:false}}) as never);
    render(<LoginPage />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete","username webauthn");
    await waitFor(()=>expect(startAuthentication).toHaveBeenCalledWith({optionsJSON:{challenge:"test"},useBrowserAutofill:true}));
    await waitFor(()=>expect(router.replace).toHaveBeenCalledWith("/pregled"));
  });
  it("kasni conditional options ne nadjača eksplicitnu prijavu",async()=>{
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(true);
    let resolveFirst!: (value:unknown)=>void;
    const first=new Promise(resolve=>{resolveFirst=resolve;});
    vi.mocked(apiCall).mockImplementation(async url=>{
      if(url.endsWith("options") && vi.mocked(apiCall).mock.calls.filter(call=>call[0].endsWith("options")).length===1) return await first as never;
      return {ok:true,data:url.endsWith("options")?{options:{challenge:"manual"}}:{mustChangePassword:false}} as never;
    });
    vi.mocked(startAuthentication).mockResolvedValue({id:"test"} as never);
    render(<LoginPage />);
    await waitFor(()=>expect(apiCall).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button",{name:/Prijavi se pomoću Passkey-ja/}));
    expect(apiCall).toHaveBeenCalledTimes(1);
    resolveFirst({ok:true,data:{options:{challenge:"old"}}});
    await waitFor(()=>expect(router.replace).toHaveBeenCalledWith("/pregled"));
    expect(startAuthentication).toHaveBeenCalledTimes(1);
    expect(startAuthentication).toHaveBeenCalledWith({optionsJSON:{challenge:"manual"},useBrowserAutofill:false});
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { checkSessionOnce, startSessionWatch } from "./session-watch";

describe("čuvar sesije (A2.5)", () => {
  it("401 je jedini razlog za odjavu", async () => {
    const fetch401 = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
    await expect(checkSessionOnce(fetch401)).resolves.toBe("unauthorized");
  });

  it("pad mreže ili timeout nikad ne odjavljuju", async () => {
    const fetchDown = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(checkSessionOnce(fetchDown)).resolves.toBe("network-error");

    const onUnauthorized = vi.fn();
    const stop = startSessionWatch({ onUnauthorized, fetchFn: fetchDown, intervalMs: 10_000 });
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onUnauthorized).not.toHaveBeenCalled();
    stop();
  });

  it("200 ostavlja korisnika na miru; 401 kroz watch zove callback", async () => {
    const onUnauthorized = vi.fn();
    const fetch401 = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
    const stop = startSessionWatch({ onUnauthorized, fetchFn: fetch401, intervalMs: 10_000 });
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
    stop();
  });
});

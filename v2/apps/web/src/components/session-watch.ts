/**
 * Čuvar sesije (A2/A2.5, 2026-11-07): odjava ISKLJUČIVO na 401.
 * Mrežna greška ili timeout nikad ne izbacuju korisnika — teren i loš signal nisu istek
 * sesije. Zato je provjera odvojena od okvira i testira se simuliranim padom mreže.
 */
export type SessionCheckResult = "ok" | "unauthorized" | "network-error";

export async function checkSessionOnce(
  fetchFn: typeof fetch = fetch,
): Promise<SessionCheckResult> {
  try {
    const response = await fetchFn("/api/me", { cache: "no-store" });
    return response.status === 401 ? "unauthorized" : "ok";
  } catch {
    return "network-error";
  }
}

export function startSessionWatch(options: {
  onUnauthorized: () => void;
  fetchFn?: typeof fetch;
  intervalMs?: number;
  target?: Pick<typeof globalThis, "addEventListener" | "removeEventListener"> & {
    document?: { addEventListener: typeof document.addEventListener; removeEventListener: typeof document.removeEventListener; visibilityState: string };
  };
}): () => void {
  const intervalMs = options.intervalMs ?? 60_000;
  const win = options.target ?? window;
  const doc = win.document ?? document;
  let stopped = false;

  async function check() {
    if (stopped) return;
    const result = await checkSessionOnce(options.fetchFn);
    if (!stopped && result === "unauthorized") options.onUnauthorized();
  }
  function onVisible() {
    if (doc.visibilityState === "visible") void check();
  }

  doc.addEventListener("visibilitychange", onVisible);
  win.addEventListener("focus", check);
  const timer = globalThis.setInterval(() => void check(), intervalMs);
  return () => {
    stopped = true;
    doc.removeEventListener("visibilitychange", onVisible);
    win.removeEventListener("focus", check);
    globalThis.clearInterval(timer);
  };
}

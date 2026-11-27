/** WebAuthn origins are trust anchors, never derived from an arbitrary Host header. */
export function passkeyOrigin(host: string | null, env: NodeJS.ProcessEnv = process.env): { origin: string; rpID: string } {
  const configured = [env.APP_URL, env.NEXT_PUBLIC_APP_URL].filter((v): v is string => Boolean(v?.trim()));
  if (configured.length > 1 && new URL(configured[0]!).origin !== new URL(configured[1]!).origin)
    throw new Error("APP_URL i NEXT_PUBLIC_APP_URL moraju imati isti origin za WebAuthn.");
  let url: URL;
  if (configured.length) {
    url = new URL(configured[0]!);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      throw new Error("APP_URL za WebAuthn mora biti origin bez putanje, queryja i korisničkih podataka.");
  } else {
    // No public hostname from a request is trusted as a security boundary. Only loopback
    // development is allowed without an explicitly configured origin.
    if (env.NODE_ENV === "production" || !host || !/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host))
      throw new Error("Za WebAuthn podesite APP_URL na pouzdani javni HTTPS origin.");
    url = new URL(`http://${host}`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local && env.NODE_ENV !== "production"))
    throw new Error("WebAuthn traži HTTPS, osim na lokalnom developmentu.");
  return { origin: url.origin, rpID: url.hostname };
}

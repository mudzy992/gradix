/**
 * Sesije kao uređaji (spec 01 §1.6) — čista pravila, bez baze.
 *
 * Zašto u domenu: „koja sesija je ovaj uređaj“ i „šta znači opozvana sesija“ moraju biti
 * isti odgovor na webu, na mobilnom i u testu. Kad to živi u React komponenti, mobilni
 * dobije drugu definiciju i korisnik vidi uređaj koji ne postoji.
 */

export type DeviceSession = {
  id: string;
  userAgent: string | null;
  deviceLabel: string | null;
  ipHash: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  expiresAt: Date;
};

/** Sesija je aktivna ako nije opozvana i nije istekla. */
export function isSessionActive(session: SessionDeviceLike, now: Date = new Date()): boolean {
  if (session.revokedAt !== null) return false;
  return session.expiresAt.getTime() > now.getTime();
}

type SessionDeviceLike = { revokedAt: Date | null; expiresAt: Date };

/**
 * Stabilni otisak uređaja za pravilo „jedna aktivna sesija po uređaju“.
 *
 * Ne hash-uje se cijeli UA: Chrome mijenja verziju svakih šest sedmica i svaka bi promjena
 * značila nov uređaj, pa bi stara sesija ostala visjeti. Uzima se familija pretraživača i
 * platforma — dovoljno da iPhone i laptop budu različiti uređaji, a da update ne pravi nov.
 */
export function deviceFingerprint(userAgent: string | null): string {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  const platform = ua.includes("iphone")
    ? "ios"
    : ua.includes("ipad")
      ? "ipados"
      : ua.includes("android")
        ? "android"
        : ua.includes("windows")
          ? "windows"
          : ua.includes("mac os")
            ? "macos"
            : ua.includes("linux")
              ? "linux"
              : "other";
  const family = ua.includes("edg/")
    ? "edge"
    : ua.includes("chrome") && !ua.includes("chromium")
      ? "chrome"
      : ua.includes("safari") && !ua.includes("chrome")
        ? "safari"
        : ua.includes("firefox")
          ? "firefox"
          : ua.includes("gradix") || ua.includes("expo") || ua.includes("okhttp")
            ? "aplikacija"
            : "other";
  return `${platform}/${family}`;
}

/**
 * Kratka oznaka uređaja za listu: „iPhone · Safari“, „Windows · Chrome“.
 *
 * Sirovi UA u listi je nečitljiv (120 znakova tehničkog smeća) i korisnik po njemu ne
 * prepoznaje svoj telefon. Zato se prikazuje familija, a puni UA ostaje u bazi za dijagnostiku.
 */
export function describeDevice(userAgent: string | null): string {
  const fingerprint = deviceFingerprint(userAgent);
  const [platform, family] = fingerprint.split("/");
  const platformLabel: Record<string, string> = {
    ios: "iPhone",
    ipados: "iPad",
    android: "Android",
    windows: "Windows",
    macos: "Mac",
    linux: "Linux",
    other: "Uređaj",
    unknown: "Nepoznat uređaj",
  };
  const familyLabel: Record<string, string> = {
    edge: "Edge",
    chrome: "Chrome",
    safari: "Safari",
    firefox: "Firefox",
    aplikacija: "Gradix aplikacija",
    other: "",
  };
  const left = platformLabel[platform ?? "other"] ?? "Uređaj";
  const right = familyLabel[family ?? "other"] ?? "";
  return right ? `${left} · ${right}` : left;
}

/**
 * Koje sesije ostaju poslije „odjavi sve ostale“: TAČNO tekuća.
 *
 * Vraća ID-eve za opoziv — namjerno, a ne boolean: servis time dobija spisak za audit, a
 * test može dokazati da tekuća NIJE na spisku.
 */
export function sessionsToRevokeOthers(
  sessions: readonly { id: string }[],
  currentSessionId: string,
): string[] {
  return sessions.filter((session) => session.id !== currentSessionId).map((session) => session.id);
}

/** „Ovo je ovaj uređaj“ — poređenje po ID-u sesije, nikad po UA. */
export function isCurrentDevice(sessionId: string, currentSessionId: string): boolean {
  return sessionId === currentSessionId;
}

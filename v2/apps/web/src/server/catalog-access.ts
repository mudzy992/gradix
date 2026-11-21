/**
 * Katalog komponenti nije javna stranica (Dio 2): u produkciji je vide samo platformski
 * administratori (env `PLATFORM_ADMIN_EMAILS`, zarezom odvojene adrese — platformski nivo,
 * izvan firmi/rola), u razvoju je otvoren kao razvojni alat. Svi ostali dobijaju 404:
 * stranica se ne oglašava ni postojanjem.
 */
export function parsePlatformAdminEmails(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function catalogAllowed(args: {
  nodeEnv: string | undefined;
  email: string | null | undefined;
  adminEmailsRaw: string | undefined | null;
}): boolean {
  if (args.nodeEnv !== "production") return true;
  if (!args.email) return false;
  return parsePlatformAdminEmails(args.adminEmailsRaw).includes(args.email.trim().toLowerCase());
}

/**
 * Prilozi: bucket, potpisani URL-ovi i — najvažnije — tip fajla iz SADRŽAJA.
 *
 * Tri pravila iz `docs/PLAN-R2.md` §5 koja se ovdje sprovode:
 *
 *  1. **Ekstenzija se ne vjeruje, `content-type` zahtjeva se ne vjeruje.** Tip se određuje iz
 *     prvih bajtova (`%PDF-`, `FF D8 FF`, …). `.exe` preimenovan u `.pdf` ne prolazi jer mu prvi
 *     bajtovi nisu `%PDF-`.
 *  2. **Nema javnog pristupa.** Upload ide na potpisan PUT (5 min), download na potpisan GET
 *     (60 s). Bucket nije javan i nema listinga.
 *  3. **Dok bucket ne postoji, ne pišemo.** ADR 0006: v2 ne piše priloge dok je bucket
 *     nedostupan. Staging koristi izolovani `gradix-stg`; umjesto tihe greške, upload se odbija
 *     sa jasnom porukom koja kaže šta treba.
 */
import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_OBLIGATION = 5;
/** Bucket i prefiks su odluka iz ADR 0006 — ne mijenjaju se po okruženju. */
export const ATTACHMENT_BUCKET = "gradix-v2";
export const ATTACHMENT_PREFIX = "gx2/";

export const UPLOAD_URL_TTL_SECONDS = 300;
export const DOWNLOAD_URL_TTL_SECONDS = 60;

export type AllowedContentType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/heic";

export const ALLOWED_CONTENT_TYPES: readonly AllowedContentType[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];

/**
 * Tip iz prvih 32 bajta. Vraća `null` kad sadržaj nije ništa od dozvoljenog — i tada se upload
 * odbija, bez obzira što piše u imenu fajla.
 */
export function detectContentType(bytes: Uint8Array): AllowedContentType | null {
  const startsWith = (signature: number[], offset = 0) =>
    bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

  // PDF: "%PDF-" (25 50 44 46 2D)
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  // JPEG: FF D8 FF
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WebP: "RIFF" .... "WEBP"
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  // HEIC/HEIF: veličina (4 B) + "ftyp" + brend (heic, heix, hevc, mif1, msf1)
  if (startsWith([0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

/** `sha256` se računa pri uploadu i čuva; isti fajl dvaput na obavezi se odbija. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Ime fajla za prikaz: bez putanje, bez kontrolnih znakova, najviše 200 znakova.
 * U bucketu ime NIJE ključ — ključ je UUID, pa ime ne može uticati na putanju objekta.
 */
export function sanitiseFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "prilog";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned.length > 0 ? cleaned : "prilog").slice(0, 200);
}

/** `gx2/{company}/{obligation}/{attachment}` — oblik iz §5.3; tenant je u putanji. */
export function objectKey(companyId: string, obligationId: string, attachmentId: string): string {
  return `${ATTACHMENT_PREFIX}${companyId}/obligations/${obligationId}/${attachmentId}`;
}

export type StorageConfig =
  | { configured: true; client: S3Client; presignClient: S3Client; bucket: string; publicEndpoint: string }
  | { configured: false; reason: string };

/**
 * Konfiguracija iz okruženja. **Nema podrazumijevanih tajni**: ako `MINIO_*` nisu postavljeni,
 * prijave se kao „nije podešeno“ umjesto da se piše u pogrešan bucket. Backend koristi interni
 * endpoint; browser-potpisani URL-ovi koriste zasebni `MINIO_PUBLIC_ENDPOINT` da nikad ne vrate
 * hostname kao `minio` koji postoji samo unutar Compose mreže.
 */
export function storageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const endpoint = env.MINIO_ENDPOINT?.trim();
  const publicEndpoint = env.MINIO_PUBLIC_ENDPOINT?.trim();
  const accessKeyId = env.MINIO_ACCESS_KEY?.trim();
  const secretAccessKey = env.MINIO_SECRET_KEY?.trim();
  const bucket = env.MINIO_BUCKET?.trim() || ATTACHMENT_BUCKET;
  const region = env.MINIO_REGION?.trim() || "us-east-1";

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return {
      configured: false,
      reason:
        "Prilozi još nisu uključeni na ovom serveru (nedostaje MINIO_ENDPOINT ili app access key). " +
        "Ostali podaci o obavezi se čuvaju normalno.",
    };
  }
  if (!publicEndpoint) {
    return {
      configured: false,
      reason: "MINIO_PUBLIC_ENDPOINT nedostaje; potpisani linkovi moraju koristiti browser-dostupan hostname.",
    };
  }

  let parsedPublicEndpoint: URL;
  try {
    for (const value of [endpoint, publicEndpoint]) {
      const parsed = new URL(value);
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.search || parsed.hash) {
        return { configured: false, reason: "MINIO_ENDPOINT i MINIO_PUBLIC_ENDPOINT moraju biti čisti http(s) URL-ovi bez userinfo/query dijela." };
      }
      if (value === publicEndpoint) parsedPublicEndpoint = parsed;
    }
  } catch {
    return { configured: false, reason: "MINIO_ENDPOINT ili MINIO_PUBLIC_ENDPOINT nije valjan http(s) URL." };
  }
  const publicHost = parsedPublicEndpoint!.hostname.toLowerCase();
  const internalHost = publicHost === "minio" || publicHost === "localhost" || publicHost.endsWith(".localhost") ||
    publicHost.endsWith(".local") || publicHost.endsWith(".lan") || publicHost.endsWith(".home.arpa") ||
    publicHost.endsWith(".internal") || publicHost.endsWith(".svc") || !publicHost.includes(".") ||
    /^(10\.|127\.|192\.168\.|169\.254\.)/.test(publicHost) || /^172\.(1[6-9]|2\d|3[01])\./.test(publicHost);
  if (env.NODE_ENV === "production" && (internalHost || parsedPublicEndpoint!.protocol !== "https:")) {
    return { configured: false, reason: "MINIO_PUBLIC_ENDPOINT mora biti javni HTTPS browser host; interni Compose host i HTTP URL se ne smiju potpisati." };
  }

  const credentials = { accessKeyId, secretAccessKey };
  const client = new S3Client({
    endpoint,
    region,
    // MinIO na hostu radi bez TLS-a u lokalnom razvoju; produkcija daje https endpoint.
    forcePathStyle: true,
    credentials,
  });
  const presignClient = publicEndpoint === endpoint
    ? client
    : new S3Client({ endpoint: publicEndpoint, region, forcePathStyle: true, credentials });

  return { configured: true, bucket, client, presignClient, publicEndpoint };
}

export async function presignUpload(input: {
  config: Extract<StorageConfig, { configured: true }>;
  key: string;
  contentType: AllowedContentType;
}): Promise<{ url: string; expiresAt: string }> {
  const url = await getSignedUrl(
    input.config.presignClient,
    new PutObjectCommand({ Bucket: input.config.bucket, Key: input.key, ContentType: input.contentType }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
  return { url, expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString() };
}

export async function presignDownload(input: {
  config: Extract<StorageConfig, { configured: true }>;
  key: string;
  fileName: string;
  contentType?: AllowedContentType;
}): Promise<{ url: string; expiresAt: string }> {
  const url = await getSignedUrl(
    input.config.presignClient,
    new GetObjectCommand({
      Bucket: input.config.bucket,
      Key: input.key,
      ResponseContentDisposition: `inline; filename="${input.fileName.replace(/"/g, "")}"`,
      ...(input.contentType ? { ResponseContentType: input.contentType } : {}),
    }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
  );
  return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
}

export type ObjectFacts = { exists: true; sizeBytes: number; contentType: string | null } | { exists: false };

/** Šta je stvarno stiglo u bucket — potvrda uploada poredi to sa prijavljenim. */
export async function statObject(input: {
  config: Extract<StorageConfig, { configured: true }>;
  key: string;
}): Promise<ObjectFacts> {
  try {
    const head = await input.config.client.send(
      new HeadObjectCommand({ Bucket: input.config.bucket, Key: input.key }),
    );
    return {
      exists: true,
      sizeBytes: Number(head.ContentLength ?? 0),
      contentType: head.ContentType ?? null,
    };
  } catch {
    return { exists: false };
  }
}

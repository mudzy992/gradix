/**
 * Brisanje objekata iz bucketa priloga — jedino što worker radi sa fajlovima.
 *
 * Worker NE uvozi `apps/web` (bio bi to web server u pozadinskom procesu), pa konfiguraciju
 * čita sam, po ISTIM imenima varijabli kao web (`MINIO_*`, vidi `storage.ts` tamo). Ista imena
 * su namjerna: u Coolify-u se env postavlja jednom za sve servise, a ne po servisu.
 *
 * Ako bucket nije podešen, `createObjectRemover` vraća `null` — posao tada ne briše ništa i to
 * PRIJAVI. Tiho preskakanje bi značilo da retencija „radi“ dok medicinski nalazi stoje.
 */
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type ObjectRemover = (objectKey: string) => Promise<void>;

export type StorageInfo =
  | { configured: true; removeObject: ObjectRemover; bucket: string }
  | { configured: false; reason: string };

export function createObjectRemover(env: NodeJS.ProcessEnv = process.env): StorageInfo {
  const endpoint = env.MINIO_ENDPOINT?.trim();
  const accessKeyId = env.MINIO_ACCESS_KEY?.trim();
  const secretAccessKey = env.MINIO_SECRET_KEY?.trim();
  const bucket = env.MINIO_BUCKET?.trim() || "gradix-v2";
  const region = env.MINIO_REGION?.trim() || "us-east-1";

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return {
      configured: false,
      reason: "Nedostaje MINIO_ENDPOINT, MINIO_ACCESS_KEY ili MINIO_SECRET_KEY — retencija se ne primjenjuje.",
    };
  }

  try {
    // Validacija URL-a prije nego što S3 klijent baci nejasnu grešku pri prvom pozivu.
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { configured: false, reason: "MINIO_ENDPOINT mora biti http(s) URL." };
    }
  } catch {
    return { configured: false, reason: "MINIO_ENDPOINT nije valjan URL." };
  }

  const client = new S3Client({
    endpoint,
    region,
    // MinIO ne podržava virtual-host stil adresiranja bez wildcard DNS-a.
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  return {
    configured: true,
    bucket,
    // Brisanje nepostojećeg objekta S3 tretira kao uspjeh (idempotentno), pa ponovni prolaz
    // posla ne pada na već obrisanom fajlu.
    removeObject: async (objectKey: string) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    },
  };
}

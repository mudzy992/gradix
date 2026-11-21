import fs from 'node:fs';
import path from 'node:path';

/**
 * INF-05: readiness poredi **primijenjene** migracije (`_prisma_migrations`) sa onim što slika
 * nosi na disku. Ako se brojevi razlikuju, deploy nije dovršen (`prisma migrate deploy` još
 * radi) ili je slika starija od baze — u oba slučaja saobraćaj ne treba da ide na instancu.
 *
 * `null` = folder ne postoji (npr. minimalna slika bez `prisma/`), pa provjera ne pada.
 */
export function expectedMigrationCount(
  baseDir: string = process.cwd(),
): number | null {
  const dir = path.join(baseDir, 'prisma', 'migrations');
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).length;
  } catch {
    return null;
  }
}

import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';

export type LatestLocationRow = {
  userId: string;
  lat: unknown;
  lng: unknown;
  recordedAt: Date;
  firstName: string;
  lastName: string;
};

/**
 * BE-12 (F-03): zadnja lokacija **po korisniku** u jednom upitu.
 *
 * Prije se radilo `findMany` svih GPS zapisa firme u zadnjih 30 minuta i onda dedupe u
 * JS mapi — pri 100 korisnika i pingu svakih 15 s to je ~12.000 redova po osvježavanju
 * dashboarda. `DISTINCT ON` (PostgreSQL, D-001) koristi postojeći indeks
 * `(companyId, userId, recordedAt)` i vraća najviše jedan red po korisniku.
 */
export function latestLocations(
  prisma: PrismaService,
  input: { companyId: string; since: Date; userIds?: string[] },
): Promise<LatestLocationRow[]> {
  if (input.userIds && input.userIds.length === 0) {
    return Promise.resolve([]);
  }
  const userFilter = input.userIds
    ? Prisma.sql`AND l."userId" IN (${Prisma.join(input.userIds)})`
    : Prisma.empty;
  return prisma.$queryRaw<LatestLocationRow[]>(Prisma.sql`
    SELECT DISTINCT ON (l."userId")
           l."userId"     AS "userId",
           l.lat          AS "lat",
           l.lng          AS "lng",
           l."recordedAt" AS "recordedAt",
           u."firstName"  AS "firstName",
           u."lastName"   AS "lastName"
    FROM "UserLocation" l
    JOIN "User" u ON u.id = l."userId"
    WHERE l."companyId" = ${input.companyId}
      AND l."recordedAt" >= ${input.since}
      ${userFilter}
    ORDER BY l."userId", l."recordedAt" DESC
  `);
}

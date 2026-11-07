import { Prisma } from '../../../generated/client';

/** Prisma adapter may surface PostgreSQL serialization failure from raw SQL as P2010. */
export function isSerializationFailure(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010') return false;
  const meta = error.meta as
    | {
        code?: unknown;
        driverAdapterError?: { cause?: { originalCode?: unknown } };
      }
    | undefined;
  return (
    meta?.code === '40001' ||
    meta?.driverAdapterError?.cause?.originalCode === '40001'
  );
}

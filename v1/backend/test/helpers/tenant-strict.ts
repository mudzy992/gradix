import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

// Deliberately empty until each exception is reviewed. A model+operation-wide
// exception affects every callsite, so a login exception can hide unsafe reads.
export const TENANT_STRICT_ALLOWLIST: ReadonlyArray<{
  model: string;
  operation: string;
  reason: string;
}> = [];

export function tenantModelsFromSchema(): Set<string> {
  const dir = resolve(process.cwd(), 'prisma/schema');
  const models = new Set<string>();
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.prisma'))
    .sort()) {
    const schema = readFileSync(join(dir, file), 'utf8').replace(
      /\/\/[^\n]*/g,
      '',
    );
    for (const match of schema.matchAll(/\bmodel\s+(\w+)\s*\{([^}]*?)\}/gs)) {
      if (/^\s*companyId\s+\w+\??(?:\s|$)/m.test(match[2]))
        models.add(match[1]);
    }
  }
  if (!models.size)
    throw new Error('TENANT_STRICT could not find any tenant models');
  return models;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasId(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0;
  return (
    object(value) && typeof value.equals === 'string' && value.equals.length > 0
  );
}
/** A single fixed tenant predicate must be unconditional, not merely one OR branch. */
export function hasCompanyConstraint(value: unknown): boolean {
  if (!object(value)) return false;
  if (hasId(value.companyId)) return true;
  const and = value.AND;
  if (Array.isArray(and)) return and.some(hasCompanyConstraint);
  return hasCompanyConstraint(and);
}
function hasCompanyData(value: unknown): boolean {
  if (Array.isArray(value))
    return value.length > 0 && value.every(hasCompanyData);
  return object(value) && hasId(value.companyId);
}
export function applyTenantStrict(prisma: PrismaService, models: Set<string>) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (models.has(model)) {
            const input = args as Record<string, unknown>;
            let scoped: boolean;
            if (
              operation === 'create' ||
              operation === 'createMany' ||
              operation === 'createManyAndReturn'
            ) {
              scoped = hasCompanyData(input.data);
            } else if (operation === 'upsert') {
              scoped =
                hasCompanyConstraint(input.where) &&
                hasCompanyData(input.create);
            } else {
              scoped = hasCompanyConstraint(input.where);
            }
            const exception = TENANT_STRICT_ALLOWLIST.find(
              (entry) => entry.model === model && entry.operation === operation,
            );
            if (process.env.TENANT_STRICT === '1') {
              process.stderr.write(
                `TENANT_STRICT_CHECK ${model}.${operation} ${scoped ? 'scoped' : exception ? 'exception' : 'denied'}\n`,
              );
            }
            if (!scoped && !exception)
              throw new Error(
                `TENANT_STRICT: ${model}.${operation} missing companyId`,
              );
          }
          return query(args);
        },
      },
    },
  });
}

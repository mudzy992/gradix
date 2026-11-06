import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSource, compareBaseline } from './check-tenant.mjs';

const models = new Set(['User']);
test('identifies direct tenant model calls without an unconditional scope', () => {
  const src = `
    prisma.user.findMany({where:{companyId}});
    tx.user.findFirst({where:{AND:[{companyId}, {id}]}});
    tx.user.findMany({where:{OR:[{companyId}, {id}]}});
    prisma.user.findUnique({where:{id}});
    prisma.user.create({data:{email,companyId}});
    prisma.user.create({data:{email}});
    prisma.user.findMany({where:{companyId:{not:null}}});
  `;
  const failures = scanSource('test.ts', src, models);
  assert.deepEqual(failures.map((x) => x.operation), ['findMany', 'findUnique', 'create', 'findMany']);
});
test('new call and duplicate over baseline fail; removal is allowed', () => {
  const call = scanSource('test.ts', 'prisma.user.findUnique({where:{id}})', models)[0];
  const baseline = [{ ...call, count: 1, reason: 'BL-TEST-01-STATIC: legacy unreviewed' }];
  assert.equal(compareBaseline([call], baseline).length, 0);
  assert.equal(compareBaseline([call, call], baseline).length, 1);
  assert.equal(compareBaseline([], baseline).length, 0);
  assert.equal(compareBaseline([call], []).length, 1);
});

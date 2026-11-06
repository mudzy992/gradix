import { Prisma } from '../../../generated/client';
import type { AuthUser } from '../../common/types/auth-user';
import type { PrismaService } from '../prisma/prisma.service';
import { DashboardProjectsService } from './dashboard-projects.service';

const actor = (
  roles: AuthUser['roles'],
  companyId: string | null = 'company-a',
) =>
  ({
    id: 'actor-a',
    tenantCompanyId: companyId,
    companyId,
    roles,
  }) as AuthUser;

function setup(rows: unknown[] = []) {
  const findMany = jest
    .fn<Promise<unknown[]>, [unknown]>()
    .mockResolvedValue(rows);
  return {
    findMany,
    service: new DashboardProjectsService({
      project: { findMany },
    } as unknown as PrismaService),
  };
}

describe('DashboardProjectsService', () => {
  it('limits active projects, returns exact money strings and does not change null/zero budgets', async () => {
    const { service, findMany } = setup([
      {
        id: 'p1',
        name: 'Project',
        status: 'IN_PROGRESS',
        plannedBudget: new Prisma.Decimal('9999999999.99'),
        currentSpend: new Prisma.Decimal('1234567890.01'),
      },
      {
        id: 'p2',
        name: 'Zero',
        status: 'PLANNING',
        plannedBudget: new Prisma.Decimal('0'),
        currentSpend: new Prisma.Decimal('0'),
      },
      {
        id: 'p3',
        name: 'No budget',
        status: 'PLANNING',
        plannedBudget: null,
        currentSpend: new Prisma.Decimal('0.1'),
      },
    ]);
    const data = await service.list(actor(['ADMIN']));
    expect(data).toEqual([
      {
        id: 'p1',
        name: 'Project',
        status: 'IN_PROGRESS',
        plannedBudget: '9999999999.99',
        currentSpend: '1234567890.01',
      },
      {
        id: 'p2',
        name: 'Zero',
        status: 'PLANNING',
        plannedBudget: '0.00',
        currentSpend: '0.00',
      },
      {
        id: 'p3',
        name: 'No budget',
        status: 'PLANNING',
        plannedBudget: null,
        currentSpend: '0.10',
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        where: {
          companyId: 'company-a',
          archivedAt: null,
          status: { in: ['PLANNING', 'IN_PROGRESS'] },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    );
  });
  it('constrains project managers to assigned projects in the selected tenant', async () => {
    const { service, findMany } = setup();
    expect(await service.list(actor(['PROJECT_MANAGER'], 'company-b'))).toEqual(
      [],
    );
    const query = findMany.mock.calls[0][0] as { where: unknown };
    expect(query.where).toEqual(
      expect.objectContaining({
        companyId: 'company-b',
        assignments: { some: { userId: 'actor-a' } },
      }),
    );
  });
  it('fails closed if tenant is missing rather than querying every company', async () => {
    const { service, findMany } = setup();
    await expect(service.list(actor(['ADMIN'], null))).rejects.toMatchObject({
      status: 403,
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});

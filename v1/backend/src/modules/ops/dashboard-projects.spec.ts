import { decimal } from '../../../test/helpers/decimal';
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
  const findMany = jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue(
    rows.map((row) => ({
      lat: null,
      lng: null,
      geofenceRadius: 100,
      ...(row as object),
    })),
  );
  const findFirst = jest.fn().mockResolvedValue({ id: 'p1' });
  return {
    findMany,
    findFirst,
    service: new DashboardProjectsService({
      project: { findMany, findFirst },
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
        plannedBudget: decimal('9999999999.99'),
        currentSpend: decimal('1234567890.01'),
      },
      {
        id: 'p2',
        name: 'Zero',
        status: 'PLANNING',
        plannedBudget: decimal('0'),
        currentSpend: decimal('0'),
      },
      {
        id: 'p3',
        name: 'No budget',
        status: 'PLANNING',
        plannedBudget: null,
        currentSpend: decimal('0.1'),
      },
    ]);
    const result = await service.list(actor(['ADMIN']));
    expect(result.meta).toEqual({ limit: 10, nextCursor: null });
    expect(result.data).toEqual([
      {
        id: 'p1',
        name: 'Project',
        status: 'IN_PROGRESS',
        lat: null,
        lng: null,
        geofenceRadius: 100,
        plannedBudget: '9999999999.99',
        currentSpend: '1234567890.01',
      },
      {
        id: 'p2',
        name: 'Zero',
        status: 'PLANNING',
        lat: null,
        lng: null,
        geofenceRadius: 100,
        plannedBudget: '0.00',
        currentSpend: '0.00',
      },
      {
        id: 'p3',
        name: 'No budget',
        status: 'PLANNING',
        lat: null,
        lng: null,
        geofenceRadius: 100,
        plannedBudget: null,
        currentSpend: '0.10',
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 11,
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
      { data: [], meta: { limit: 10, nextCursor: null } },
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
  it('paginates with a scoped cursor and exposes the next cursor without changing the data array', async () => {
    const rows = ['p1', 'p2', 'p3'].map((id) => ({
      id,
      name: id,
      status: 'PLANNING',
      plannedBudget: null,
      currentSpend: decimal('0'),
    }));
    const { service, findMany, findFirst } = setup(rows);
    const page = await service.list(actor(['PROJECT_MANAGER']), {
      limit: 2,
      cursor: 'p1',
    });
    expect(page).toMatchObject({
      data: [{ id: 'p1' }, { id: 'p2' }],
      meta: { limit: 2, nextCursor: 'p2' },
    });
    const firstCalls = findFirst.mock.calls as unknown as Array<
      [{ where: unknown }]
    >;
    expect(firstCalls[0][0].where).toEqual(
      expect.objectContaining({
        id: 'p1',
        companyId: 'company-a',
        assignments: { some: { userId: 'actor-a' } },
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, cursor: { id: 'p1' }, skip: 1 }),
    );
  });
  it('rejects a cursor that is not visible within the selected tenant', async () => {
    const { service, findMany, findFirst } = setup();
    findFirst.mockResolvedValue(null);
    await expect(
      service.list(actor(['ADMIN']), { cursor: 'foreign' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(findMany).not.toHaveBeenCalled();
  });
  it('returns project coordinates as exact decimal strings and preserves missing geometry', async () => {
    const { service } = setup([
      {
        id: 'p1',
        name: 'Geo',
        status: 'IN_PROGRESS',
        plannedBudget: null,
        currentSpend: decimal('0'),
        lat: decimal('43.8562581'),
        lng: decimal('18.4130763'),
        geofenceRadius: 200,
      },
      {
        id: 'p2',
        name: 'Empty',
        status: 'PLANNING',
        plannedBudget: null,
        currentSpend: decimal('0'),
        lat: null,
        lng: null,
        geofenceRadius: 100,
      },
    ]);
    const result = await service.list(actor(['ADMIN']));
    expect(result.data).toMatchObject([
      { id: 'p1', lat: '43.8562581', lng: '18.4130763', geofenceRadius: 200 },
      { id: 'p2', lat: null, lng: null, geofenceRadius: 100 },
    ]);
  });
});

jest.mock(
  '../../../generated/client',
  () => ({ Prisma: { Decimal: class Decimal {} } }),
  { virtual: true },
);
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import type { PrismaService } from '../prisma/prisma.service';
import type { TimerForceCloseService } from './timer-force-close.service';
import { TimerCronService } from './timer-cron.service';

type Fake = {
  prisma: PrismaService;
  closer: TimerForceCloseService;
  settingsReads: string[];
  closed: string[];
};

function fake(
  sessions: { id: string; companyId: string; hoursAgo: number }[],
): Fake {
  const settingsReads: string[] = [];
  const closed: string[] = [];
  const now = Date.now();
  const prisma = {
    timerSession: {
      findMany: () =>
        Promise.resolve(
          sessions.map((session) => ({
            id: session.id,
            companyId: session.companyId,
            userId: `user-${session.id}`,
            startedAt: new Date(now - session.hoursAgo * 60 * 60 * 1000),
          })),
        ),
    },
    setting: {
      findUnique: (args: {
        where: { companyId_key: { companyId: string } };
      }) => {
        const companyId = args.where.companyId_key.companyId;
        settingsReads.push(companyId);
        return Promise.resolve({ value: 12 });
      },
    },
  } as unknown as PrismaService;
  const closer = {
    closeSession: (session: { id: string }) => {
      closed.push(session.id);
      return Promise.resolve(session);
    },
  } as unknown as TimerForceCloseService;
  return { prisma, closer, settingsReads, closed };
}

describe('TimerCronService.closeStale', () => {
  it('čita timer.maxOpenHours jednom po firmi, ne po sesiji', async () => {
    const f = fake([
      { id: 'a', companyId: 'c1', hoursAgo: 13 },
      { id: 'b', companyId: 'c1', hoursAgo: 14 },
      { id: 'c', companyId: 'c2', hoursAgo: 20 },
    ]);
    await new TimerCronService(f.prisma, f.closer).closeStale();
    expect(f.settingsReads).toEqual(['c1', 'c2']);
    expect(f.closed).toEqual(['a', 'b', 'c']);
  });

  it('ne zatvara sesije mlađe od timer.maxOpenHours', async () => {
    const f = fake([
      { id: 'young', companyId: 'c1', hoursAgo: 2 },
      { id: 'old', companyId: 'c1', hoursAgo: 13 },
    ]);
    await new TimerCronService(f.prisma, f.closer).closeStale();
    expect(f.closed).toEqual(['old']);
  });
});

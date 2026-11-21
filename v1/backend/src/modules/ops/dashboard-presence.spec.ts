// `generated/client` se ne generiše u unit testovima (nema baze), a `latest-locations.ts`
// ga uvozi radi `Prisma.sql` — mock je samo za razrješavanje modula.
jest.mock(
  '../../../generated/client',
  () => ({
    Prisma: {
      sql: () => ({}),
      join: () => ({}),
      empty: {},
    },
    PrismaClient: class {},
  }),
  { virtual: true },
);

import {
  avgProgress,
  presenceForProject,
  presenceForProjects,
  spendCard,
} from './dashboard-presence';

const SARAJEVO = { lat: '43.8563000', lng: '18.4131000' };
const PROJECT_A = {
  id: 'p-a',
  lat: SARAJEVO.lat,
  lng: SARAJEVO.lng,
  geofenceRadius: 500,
};
const PROJECT_B = {
  id: 'p-b',
  lat: '43.8565000',
  lng: '18.4135000',
  geofenceRadius: 500,
};
const NO_GEO = {
  id: 'p-c',
  lat: null,
  lng: null,
  geofenceRadius: 200,
};

function row(
  userId: string,
  lat: string,
  lng: string,
  firstName = 'Ime',
  lastName = 'Prezime',
) {
  return {
    userId,
    lat,
    lng,
    recordedAt: new Date('2026-11-03T10:00:00.000Z'),
    firstName,
    lastName,
  };
}

describe('dashboard-presence (BE-12)', () => {
  describe('presenceForProjects', () => {
    it('prijavljuje korisnika samo jednom, iako upada u dva geofence-a', () => {
      const people = presenceForProjects(
        [row('u1', '43.85640', '18.41320')],
        [PROJECT_A, PROJECT_B],
      );
      expect(people).toHaveLength(1);
      expect(people[0].userId).toBe('u1');
      expect(people[0].projectId).toBe(PROJECT_A.id);
      expect(people[0].lastSeenAt).toBeInstanceOf(Date);
    });

    it('izostavlja korisnike van svih geofence-a i projekte bez koordinata', () => {
      const people = presenceForProjects(
        [row('u1', '44.20000', '17.90000')],
        [PROJECT_A, NO_GEO],
      );
      expect(people).toEqual([]);
    });

    it('bez ijednog projekta sa koordinatama ne vraća nikoga', () => {
      expect(
        presenceForProjects([row('u1', '43.85', '18.41')], [NO_GEO]),
      ).toEqual([]);
    });
  });

  describe('presenceForProject', () => {
    it('filtrira na jedan projekat i ne izlaže koordinate', () => {
      const people = presenceForProject(
        [row('u1', '43.85640', '18.41320'), row('u2', '44.20000', '17.90000')],
        PROJECT_A,
      );
      expect(people).toHaveLength(1);
      expect(people[0]).toEqual({
        userId: 'u1',
        firstName: 'Ime',
        lastName: 'Prezime',
        lastSeenAt: new Date('2026-11-03T10:00:00.000Z'),
      });
      expect(people[0]).not.toHaveProperty('lat');
      expect(people[0]).not.toHaveProperty('lng');
    });

    it('projekat bez koordinata → prazna lista', () => {
      expect(presenceForProject([row('u1', '43.85', '18.41')], NO_GEO)).toEqual(
        [],
      );
    });
  });

  describe('spendCard / avgProgress', () => {
    it('sabira potrošnju i budžete kao brojeve, ne kao stringove', () => {
      expect(
        spendCard([
          { plannedBudget: '1000.00', currentSpend: '250.50' },
          { plannedBudget: '500.00', currentSpend: '100.00' },
        ]),
      ).toEqual({ spend: '350.50', budget: '1500.00' });
    });

    it('ako nijedan projekat nema budžet, budžet je null (ne 0)', () => {
      expect(
        spendCard([{ plannedBudget: null, currentSpend: '10.00' }]),
      ).toEqual({ spend: '10.00', budget: null });
    });

    it('prosječan napredak se zaokružuje; prazna lista → null', () => {
      expect(
        avgProgress([{ progressPercent: 10 }, { progressPercent: 21 }]),
      ).toBe(16);
      expect(avgProgress([])).toBeNull();
    });
  });
});

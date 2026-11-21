jest.mock(
  '../../../generated/client',
  () => ({ Prisma: {}, PrismaClient: class {} }),
  { virtual: true },
);

import {
  serializePublicCompany,
  serializePublicProject,
} from './serialize-public';
import type { Company, Project } from '../../../generated/client';

const company = {
  id: 'company-1',
  slug: 'gradix',
  name: 'Gradix doo',
  city: 'Visoko',
  address: 'Ulica 1',
  phone: '+387 32 000 000',
  taxId: '123456789',
  email: 'office@gradix.ba',
  country: 'BA',
  isActive: true,
  logoAssetId: 'asset-1',
  logoPath: 'company-1/logo.png',
  createdAt: new Date('2026-11-06T12:00:00.000Z'),
  updatedAt: new Date('2026-11-06T12:00:00.000Z'),
} as unknown as Company;

const project = {
  id: 'project-1',
  name: 'Most',
  locality: 'Sarajevo',
  status: 'ACTIVE',
  isPublic: true,
  coverAssetId: 'asset-2',
  plannedBudget: '100000',
  currentSpend: '25000',
  geofenceRadius: 200,
  companyId: 'company-1',
  archivedAt: null,
} as unknown as Project;

describe('serialize-public (BE-16)', () => {
  it('javna firma ne curi poreski broj, email ni interni id', () => {
    const dto = serializePublicCompany(company, {});
    const raw = JSON.stringify(dto);
    expect(raw).not.toContain('123456789');
    expect(raw).not.toContain('office@gradix.ba');
    expect(raw).not.toContain('company-1/logo.png');
    expect(Object.keys(dto).sort()).toEqual([
      'address',
      'city',
      'contact',
      'logoAssetId',
      'name',
      'phone',
      'slug',
      'tagline',
    ]);
  });

  it('postavke firme mijenjaju prikazno ime, ne slug', () => {
    const dto = serializePublicCompany(company, {
      'public.companyName': '  Gradix Gradnja  ',
      'public.tagline': 'Gradimo povjerenje',
      'public.contact': 'info@example.com',
    });
    expect(dto.name).toBe('Gradix Gradnja');
    expect(dto.slug).toBe('gradix');
    expect(dto.tagline).toBe('Gradimo povjerenje');
  });

  it('javni projekat ne curi budžet, potrošnju ni geofence', () => {
    const dto = serializePublicProject(project);
    expect(Object.keys(dto).sort()).toEqual([
      'coverAssetId',
      'id',
      'locality',
      'name',
      'status',
    ]);
    expect(JSON.stringify(dto)).not.toContain('100000');
    expect(JSON.stringify(dto)).not.toContain('25000');
  });
});

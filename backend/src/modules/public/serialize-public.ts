import { Company, Project } from '../../../generated/client';

export type PublicCompanyDto = {
  slug: string;
  name: string;
  tagline: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  logoAssetId: string | null;
  contact: string;
};

export type PublicProjectDto = {
  id: string;
  name: string;
  locality: string | null;
  status: string;
  coverAssetId: string | null;
};

export function serializePublicCompany(
  company: Company,
  settings: Record<string, string>,
): PublicCompanyDto {
  const override = settings['public.companyName']?.trim();
  return {
    slug: company.slug,
    name: override || company.name,
    tagline: settings['public.tagline'] ?? '',
    city: company.city,
    address: company.address,
    phone: company.phone,
    logoAssetId: company.logoAssetId,
    contact: settings['public.contact'] ?? '',
  };
}

export function serializePublicProject(project: Project): PublicProjectDto {
  return {
    id: project.id,
    name: project.name,
    locality: project.locality,
    status: project.status,
    coverAssetId: project.coverAssetId,
  };
}

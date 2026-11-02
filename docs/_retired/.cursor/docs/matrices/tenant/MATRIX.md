# Tenant / Company — matrica

Status: **locked** (Faza 1).

- `Company`: name, slug unique, isActive, legalName?, address?, city?, country default `BA`, taxId?, phone?, email?, logoPath?, timestamps
- Slug: `[a-z0-9-]{3,40}` (`TENANT_SLUG_INVALID`); **immutable** (`TENANT_SLUG_IMMUTABLE`)
- ID: cuid string na svim tabelama
- Sve poslovne tabele: `companyId` + index
- User: firstName + lastName obavezno; employeeCode? unique po firmi; `companyId` nullable samo PLATFORM_ADMIN; `mustChangePassword`; `locale` bs|en default bs
- Unique email globalno (deaktiviran zauzet); phone unique globalno ako postoji
- Brisanje firme: nije u MVP (`isActive=false`). Login usera te firme → 401 `AUTH_COMPANY_INACTIVE`. PLATFORM_ADMIN PATCH može vratiti true. Na false: revoke all; force-close timera od Faze 2.
- ADMIN/SUPER_ADMIN: `PATCH /api/company` (`settings.write`) — pravna polja + logo; ne slug. PLATFORM_ADMIN: `PATCH /api/companies/:id` (uključujući isActive).
- Seed: Company `demo`; PLATFORM_ADMIN `platform@gradix.local`; prvi user firme = SUPER_ADMIN `admin@gradix.local` (`mustChangePassword=false` na seedu)

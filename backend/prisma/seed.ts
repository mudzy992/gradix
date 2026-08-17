import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/client';
import { hashPassword } from '../src/common/utils/password';
import { defaultSettingRows } from '../src/modules/companies/default-settings';
import { MIN_PASSWORD_LENGTH } from '../src/common/constants';
import { seedDemoOps } from './seed-demo-ops';
import { seedDemoFleet } from './seed-demo-fleet';

function createPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  return new PrismaClient({ adapter: new PrismaMariaDb(url) });
}

async function seed(): Promise<void> {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error('SEED_PASSWORD must be at least 10 characters');
  }
  const prisma = createPrisma();
  const passwordHash = await hashPassword(password);
  const company = await prisma.company.upsert({
    where: { slug: 'demo' },
    update: { name: 'Demo Gradnja', city: 'Sarajevo' },
    create: {
      name: 'Demo Gradnja',
      slug: 'demo',
      city: 'Sarajevo',
      country: 'BA',
    },
  });
  await prisma.setting.deleteMany({ where: { companyId: company.id } });
  await prisma.setting.createMany({ data: defaultSettingRows(company.id) });
  const platform = await prisma.user.upsert({
    where: { email: 'platform@gradix.local' },
    update: {
      firstName: 'Platform',
      lastName: 'Admin',
      passwordHash,
      mustChangePassword: false,
      isActive: true,
      companyId: null,
    },
    create: {
      email: 'platform@gradix.local',
      firstName: 'Platform',
      lastName: 'Admin',
      passwordHash,
      mustChangePassword: false,
      companyId: null,
    },
  });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: platform.id } });
  await prisma.userRoleAssignment.create({
    data: { userId: platform.id, role: 'PLATFORM_ADMIN' },
  });
  const admin = await prisma.user.upsert({
    where: { email: 'admin@gradix.local' },
    update: {
      firstName: 'Demo',
      lastName: 'Admin',
      passwordHash,
      mustChangePassword: false,
      isActive: true,
      companyId: company.id,
    },
    create: {
      email: 'admin@gradix.local',
      firstName: 'Demo',
      lastName: 'Admin',
      passwordHash,
      mustChangePassword: false,
      companyId: company.id,
    },
  });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: admin.id } });
  await prisma.userRoleAssignment.create({
    data: { userId: admin.id, role: 'SUPER_ADMIN' },
  });
  await seedDemoOps(prisma, { companyId: company.id, passwordHash });
  await prisma.setting.update({
    where: { companyId_key: { companyId: company.id, key: 'public.companyName' } },
    data: { value: 'Demo Gradnja' },
  });
  await prisma.setting.update({
    where: { companyId_key: { companyId: company.id, key: 'public.tagline' } },
    data: { value: 'Gradimo pouzdano.' },
  });
  await prisma.setting.update({
    where: { companyId_key: { companyId: company.id, key: 'public.contact' } },
    data: { value: 'info@demo.local' },
  });
  const demo = await prisma.project.findFirst({ where: { companyId: company.id, code: 'DEMO-1' } });
  if (demo) {
    await prisma.project.update({ where: { id: demo.id }, data: { isPublic: true } });
  }
  const driver = await prisma.user.findUnique({ where: { email: 'driver@gradix.local' } });
  if (demo && driver) {
    await seedDemoFleet(prisma, {
      companyId: company.id,
      projectId: demo.id,
      driverId: driver.id,
    });
  }
  await prisma.$disconnect();
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

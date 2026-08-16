import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth(): Promise<{ process: string; mysql: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { process: 'ok', mysql: 'ok' };
  }
}

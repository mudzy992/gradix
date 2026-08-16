import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';

type WriteAuditInput = {
  companyId: string | null;
  actorId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  payload: Prisma.InputJsonValue;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async write(input: WriteAuditInput): Promise<void> {
    await this.prisma.auditEvent.create({ data: input });
  }
}

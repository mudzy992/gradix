import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * BE-04: audit je **evidencija**, ne uslov za poslovnu operaciju. Ranije je pad upisa
   * (npr. FK, privremeni prekid) vraćao 500 klijentu iako je izmjena već committed — uz to
   * je `void` pozivima pravio neuhvaćene promise-e. Sada se greška loguje, a zahtjev nastavlja.
   */
  async write(input: WriteAuditInput): Promise<void> {
    try {
      await this.prisma.auditEvent.create({ data: input });
    } catch (error) {
      this.logger.error(
        `Audit zapis nije upisan (${input.action} ${input.entityType}:${input.entityId})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

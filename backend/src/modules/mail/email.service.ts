import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * BE-16 (F-01, B1, D-013): ranije je `trySend` vraćao `true` čim je firma uključila
 * `features.email` — iako **ništa nije slao**. Pozivaoci su na osnovu toga govorili
 * korisniku „poslano“, a `smtpCalls` je bio samo brojač za testove. Do uvođenja pravog
 * SMTP transporta (nova zavisnost + kredencijali) servis mora biti **iskren**: vraća
 * `false` i loguje zašto. Nijedan tok ne smije prijaviti uspjeh koji se nije desio.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private warned = false;

  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(companyId: string): Promise<boolean> {
    const row = await this.prisma.setting.findUnique({
      where: { companyId_key: { companyId, key: 'features.email' } },
    });
    return row?.value === true;
  }

  /**
   * @returns `true` samo ako je poruka **stvarno** predata transportu. Bez SMTP-a je
   * uvijek `false`, bez obzira na `features.email` (flag ostaje za budući transport).
   */
  async trySend(input: {
    companyId: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<boolean> {
    const enabled = await this.isEnabled(input.companyId);
    if (!enabled) {
      return false;
    }
    if (!this.warned) {
      this.warned = true;
      this.logger.warn(
        'features.email je uključen, ali SMTP transport nije implementiran (B1) — poruke se ne šalju.',
      );
    }
    this.logger.debug(
      `Email nije poslan (nema transporta): to=${input.to} subject=${input.subject} len=${input.text.length}`,
    );
    return false;
  }
}

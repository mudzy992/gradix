import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmailService {
  smtpCalls = 0;

  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(companyId: string): Promise<boolean> {
    const row = await this.prisma.setting.findUnique({
      where: { companyId_key: { companyId, key: 'features.email' } },
    });
    return row?.value === true;
  }

  async trySend(input: {
    companyId: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<boolean> {
    if (!(await this.isEnabled(input.companyId))) {
      return false;
    }
    this.smtpCalls += 1;
    void input.to;
    void input.subject;
    void input.text;
    return true;
  }
}

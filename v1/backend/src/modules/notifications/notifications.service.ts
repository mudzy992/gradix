import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { NotificationQueryDto } from './notifications.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(actor: AuthUser, query: NotificationQueryDto) {
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.NotificationWhereInput = {
      userId: actor.id,
      ...(query.unread === 'true' ? { isRead: false } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return listResult(rows, total, page, limit);
  }

  async markRead(actor: AuthUser, id: string) {
    const row = await this.prisma.notification.findFirst({
      where: { id, userId: actor.id },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Notification not found', 404);
    }
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(actor: AuthUser) {
    await this.prisma.notification.updateMany({
      where: { userId: actor.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { ok: true };
  }

  async createForUser(input: {
    companyId: string;
    userId: string;
    type: Prisma.NotificationCreateInput['type'];
    title: string;
    message: string;
    data?: Prisma.InputJsonValue;
  }) {
    const row = await this.prisma.notification.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        data: input.data ?? {},
      },
    });
    this.realtime.emitNotification(input.userId, row);
    return row;
  }

  /**
   * BE-16 (F-05): notifikacija za N korisnika (cronovi, odbijanje plate, HSE) radila je
   * N pojedinačnih `INSERT`-ova u nizu. Sada je jedan `createMany`, pa jedan realtime
   * emit po korisniku — bez N round-tripova do baze.
   */
  async createForUsers(input: {
    companyId: string;
    userIds: string[];
    type: Prisma.NotificationCreateInput['type'];
    title: string;
    message: string;
    data?: Prisma.InputJsonValue;
  }): Promise<number> {
    const unique = [...new Set(input.userIds)];
    if (unique.length === 0) {
      return 0;
    }
    const data = input.data ?? {};
    const created = await this.prisma.notification.createManyAndReturn({
      data: unique.map((userId) => ({
        companyId: input.companyId,
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        data,
      })),
    });
    for (const row of created) {
      this.realtime.emitNotification(row.userId, row);
    }
    return created.length;
  }
}

import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  emitSettingsUpdated(companyId: string, key: string): void {
    this.server?.to(`company:${companyId}`).emit('settings:updated', { key });
  }

  emitNotification(userId: string, payload: unknown): void {
    this.server?.to(`user:${userId}`).emit('notification:new', payload);
  }
}

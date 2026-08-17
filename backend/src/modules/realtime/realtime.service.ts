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

  joinProject(userId: string, projectId: string): void {
    this.server?.in(`user:${userId}`).socketsJoin(`project:${projectId}`);
  }

  leaveProject(userId: string, projectId: string): void {
    this.server?.in(`user:${userId}`).socketsLeave(`project:${projectId}`);
  }

  joinCompanyWideToProject(companyId: string, projectId: string): void {
    void this.server?.fetchSockets().then((sockets) => {
      for (const socket of sockets) {
        const data = socket.data as { companyId?: string; companyWide?: boolean };
        if (data.companyId === companyId && data.companyWide) {
          void socket.join(`project:${projectId}`);
        }
      }
    });
  }

  emitProject(
    projectId: string,
    event: string,
    payload: { id: string; projectId: string; taskId?: string },
  ): void {
    this.server?.to(`project:${projectId}`).emit(event, payload);
  }

  emitCompany(companyId: string, event: string, payload: { id: string }): void {
    this.server?.to(`company:${companyId}`).emit(event, payload);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';

@WebSocketGateway({ cors: { origin: true } })
@Injectable()
export class AppGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AppGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.setServer(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.readToken(client);
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { roles: true },
      });
      if (!user || !user.isActive) {
        client.disconnect();
        return;
      }
      await client.join(`user:${user.id}`);
      if (user.companyId) {
        await client.join(`company:${user.companyId}`);
      }
      client.on('join', () => undefined);
    } catch {
      this.logger.debug('socket auth failed');
      client.disconnect();
    }
  }

  private readToken(client: Socket): string {
    const auth = client.handshake.auth as { token?: string };
    if (auth.token) {
      return auth.token;
    }
    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice(7);
    }
    throw new Error('missing token');
  }
}

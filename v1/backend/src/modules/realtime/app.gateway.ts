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
import { resolveCorsOrigin } from '../../config/env';
import { RealtimeService } from './realtime.service';
import { joinScopedProjectRooms } from './join-project-rooms';

/**
 * BE-16 (F-02): gateway je dozvoljavao **svaki** origin (`origin: true`) — nezavisno od
 * `CORS_ORIGIN` koji važi za HTTP. Auth je token u handshake-u (ne kolačić), ali politika
 * mora biti ista kao za REST (D-018): produkcija bez liste = samo same-origin.
 */
@WebSocketGateway({
  cors: {
    origin: resolveCorsOrigin(process.env.NODE_ENV, process.env.CORS_ORIGIN),
    credentials: true,
  },
})
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
        include: { roles: true, company: { select: { isActive: true } } },
      });
      // BE-16 (F-09): deaktivirana firma ne smije držati otvoren realtime kanal.
      if (!user || !user.isActive || user.company?.isActive === false) {
        client.disconnect();
        return;
      }
      await client.join(`user:${user.id}`);
      if (user.companyId) {
        await client.join(`company:${user.companyId}`);
      }
      await joinScopedProjectRooms(client, this.prisma, user);
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

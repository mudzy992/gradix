import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';

type EnvelopeBody = {
  data: unknown;
  meta?: unknown;
};

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }
    return next.handle().pipe(map((value) => this.wrap(value)));
  }

  private wrap(value: unknown): unknown {
    if (this.hasMeta(value)) {
      return { success: true, data: value.data, meta: value.meta };
    }
    return { success: true, data: value ?? null };
  }

  private hasMeta(value: unknown): value is EnvelopeBody {
    return (
      typeof value === 'object' &&
      value !== null &&
      'data' in value &&
      'meta' in value
    );
  }
}

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, firstValueFrom } from 'rxjs';
import { EnvelopeInterceptor } from './envelope.interceptor';

const context = {
  getHandler: () => () => undefined,
  getClass: () => class {},
} as unknown as ExecutionContext;
const handlerReturning = (value: unknown): CallHandler => ({ handle: () => of(value) });

function interceptor(skip: boolean): EnvelopeInterceptor {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(skip) } as unknown as Reflector;
  return new EnvelopeInterceptor(reflector);
}

describe('EnvelopeInterceptor', () => {
  it('umotava običan rezultat u { success, data }', async () => {
    const result = await firstValueFrom(interceptor(false).intercept(context, handlerReturning({ id: 1 })));
    expect(result).toEqual({ success: true, data: { id: 1 } });
  });

  it('prosljeđuje meta kad ga handler vrati', async () => {
    const result = await firstValueFrom(
      interceptor(false).intercept(context, handlerReturning({ data: [1, 2], meta: { page: 1 } })),
    );
    expect(result).toEqual({ success: true, data: [1, 2], meta: { page: 1 } });
  });

  it('pretvara undefined u null (ugovor: data nikad nije izostavljen)', async () => {
    const result = await firstValueFrom(interceptor(false).intercept(context, handlerReturning(undefined)));
    expect(result).toEqual({ success: true, data: null });
  });

  it('ne umotava kad je @SkipEnvelope postavljen', async () => {
    const result = await firstValueFrom(interceptor(true).intercept(context, handlerReturning('raw')));
    expect(result).toBe('raw');
  });
});

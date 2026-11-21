import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

/**
 * INF-04: korelacioni ID putuje kroz async lanac (middleware → servisi → logger) bez
 * provlačenja parametra kroz svaki potpis. `AsyncLocalStorage` je dio Node-a (bez zavisnosti).
 */
const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

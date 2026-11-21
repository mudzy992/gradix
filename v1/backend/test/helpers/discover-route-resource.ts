import type { Route } from './route-inventory';

type ListResponse = { status: number; body: { data?: unknown } };
type RequestList = (path: string) => Promise<ListResponse>;
type Discovery =
  { ok: true; path: string; ids: string[] } | { ok: false; reason: string };

/** Follow inventoried list endpoints left-to-right; no endpoint-specific fixture mapping. */
export async function discoverRouteResource(
  route: Route,
  inventory: Route[],
  get: RequestList,
): Promise<Discovery> {
  const pattern = route.path.split('/').filter(Boolean);
  const resolved: string[] = [];
  const prefixPattern: string[] = [];
  const ids: string[] = [];
  for (const segment of pattern) {
    if (!segment.startsWith(':')) {
      resolved.push(segment);
      prefixPattern.push(segment);
      continue;
    }
    const listPattern = '/' + prefixPattern.join('/');
    if (
      !inventory.some(
        (candidate) =>
          candidate.method === 'GET' && candidate.path === listPattern,
      )
    ) {
      return { ok: false, reason: `no GET list for ${listPattern}` };
    }
    const listPath = '/' + resolved.join('/');
    const response = await get(listPath);
    if (response.status >= 500 || response.status === 401) {
      throw new Error(
        `Unexpected list status ${response.status} for ${listPattern}`,
      );
    }
    if (response.status !== 200)
      return {
        ok: false,
        reason: `list ${listPattern} status ${response.status}`,
      };
    const data = response.body.data;
    if (!Array.isArray(data) || data.length === 0)
      return { ok: false, reason: `list ${listPattern} empty or non-array` };
    const parameter = segment.slice(1);
    const first: unknown = data[0];
    if (!first || typeof first !== 'object')
      return { ok: false, reason: `list ${listPattern} has no record` };
    const record = first as Record<string, unknown>;
    const value: unknown =
      parameter === 'id' ? record.id : (record[parameter] ?? record.id);
    if (typeof value !== 'string' || value.length === 0)
      return {
        ok: false,
        reason: `list ${listPattern} missing ${parameter}/id`,
      };
    ids.push(value);
    resolved.push(encodeURIComponent(value));
    prefixPattern.push(segment);
  }
  if (!ids.length) return { ok: false, reason: 'no path parameter' };
  return { ok: true, path: '/' + resolved.join('/'), ids };
}

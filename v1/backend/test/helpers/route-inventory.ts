import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { PERMISSIONS_KEY } from '../../src/common/decorators/require-permissions.decorator';
import { TENANT_ROUTE_KEY } from '../../src/common/decorators/tenant-route.decorator';
import { ROLES } from '../../src/common/rbac/roles';

export const roles = ['ANONYMOUS', ...ROLES] as const;
export const tenantContexts = [
  'no_header',
  'own_company_header',
  'other_company_header',
  'unknown_company_header',
] as const;

export type Route = {
  method: string;
  path: string;
  controller: string;
  handler: string;
  public: boolean;
  tenantRoute: boolean;
  permissions: string[];
};
export type MatrixRow = {
  method: string;
  path: string;
  role: string;
  tenantContext: string;
  evidence: 'unassessed';
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const paths = (value: string | string[]) =>
  Array.isArray(value) ? value : [value];

/** Declared controller metadata, not proof of service-level authorization. */
export function collectRoutes(app: INestApplication): Route[] {
  const modules = app.get(ModulesContainer);
  const scanner = new MetadataScanner();
  const reflector = app.get(Reflector);
  const routes: Route[] = [];
  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const klass = wrapper.metatype;
      const instance = wrapper.instance as object | undefined;
      if (!klass || !instance) continue;
      const root = Reflect.getMetadata(PATH_METADATA, klass) as
        string | string[] | undefined;
      if (root === undefined) continue;
      const prototype = Object.getPrototypeOf(instance) as Record<
        string,
        unknown
      >;
      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        const subpath = Reflect.getMetadata(PATH_METADATA, handler) as
          string | string[] | undefined;
        if (method === undefined || subpath === undefined) continue;
        const metadataTargets = [handler, klass];
        for (const prefix of paths(root))
          for (const suffix of paths(subpath)) {
            const path =
              '/' +
              ['api', prefix, suffix]
                .flatMap((part) => part.split('/'))
                .filter(Boolean)
                .join('/');
            routes.push({
              method: RequestMethod[method],
              path,
              controller: klass.name,
              handler: name,
              public:
                reflector.getAllAndOverride<boolean>(
                  IS_PUBLIC_KEY,
                  metadataTargets,
                ) ?? false,
              tenantRoute:
                reflector.getAllAndOverride<boolean>(
                  TENANT_ROUTE_KEY,
                  metadataTargets,
                ) ?? false,
              permissions:
                reflector.getAllAndOverride<string[]>(
                  PERMISSIONS_KEY,
                  metadataTargets,
                ) ?? [],
            });
          }
      }
    }
  }
  routes.sort(
    (a, b) =>
      compare(a.path, b.path) ||
      compare(a.method, b.method) ||
      compare(a.controller, b.controller),
  );
  const keys = routes.map((route) => `${route.method} ${route.path}`);
  if (new Set(keys).size !== keys.length)
    throw new Error(
      'Duplicate controller method/path; inspect routing before generating inventory',
    );
  return routes;
}

export function makeMatrix(routes: Route[]): MatrixRow[] {
  return routes.flatMap(({ method, path }) =>
    roles.flatMap((role) =>
      tenantContexts.map((tenantContext) => ({
        method,
        path,
        role,
        tenantContext,
        evidence: 'unassessed' as const,
      })),
    ),
  );
}

export function toCsv(rows: string[][]): string {
  return (
    rows
      .map((row) =>
        row
          .map((cell) =>
            /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
          )
          .join(','),
      )
      .join('\n') + '\n'
  );
}

export function renderRouteCsv(routes: Route[]): string {
  return toCsv([
    [
      'method',
      'path',
      'controller',
      'handler',
      'public',
      'tenantRoute',
      'permissions',
    ],
    ...routes.map((r) => [
      r.method,
      r.path,
      r.controller,
      r.handler,
      String(r.public),
      String(r.tenantRoute),
      r.permissions.join('|'),
    ]),
  ]);
}
export function renderMatrixCsv(routes: Route[]): string {
  return toCsv([
    ['method', 'path', 'role', 'tenantContext', 'evidence'],
    ...makeMatrix(routes).map((r) => [
      r.method,
      r.path,
      r.role,
      r.tenantContext,
      r.evidence,
    ]),
  ]);
}

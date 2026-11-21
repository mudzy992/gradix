import {
  contractIssues,
  compareContractExceptions,
} from './helpers/openapi-contract';

describe('OpenAPI contract rules', () => {
  const route = { method: 'GET', path: '/api/items', handler: 'list' };
  const good = {
    responses: {
      '200': {
        description: 'ok',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      '400': {
        description: 'invalid input',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      '401': {
        description: 'not logged in',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      '403': {
        description: 'forbidden',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      '404': {
        description: 'not found',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
    },
    parameters: [
      { in: 'query', name: 'cursor' },
      { in: 'query', name: 'limit' },
    ],
  };
  it('accepts a typed response, named errors and cursor pagination', () => {
    expect(contractIssues(route, good)).toEqual([]);
  });
  it('reports missing DTO, response type, error descriptions and pagination', () => {
    expect(
      contractIssues(
        { method: 'POST', path: '/api/items', handler: 'create' },
        { responses: { '201': { description: '' } } },
      ),
    ).toEqual(
      expect.arrayContaining([
        'request-schema',
        'response-schema-201',
        'error-400',
        'error-401',
        'error-403',
        'error-404',
      ]),
    );
    expect(
      contractIssues(route, {
        ...good,
        parameters: [{ in: 'query', name: 'page' }],
      }),
    ).toContain('cursor-limit');
  });
  it('requires explicit classification of unrecognised GET shapes', () => {
    const getRoute = { method: 'GET', path: '/api/example', handler: 'get' };
    expect(contractIssues(getRoute, good)).toContain('list-classification');
    expect(
      contractIssues(getRoute, { ...good, 'x-gradix-response-kind': 'single' }),
    ).not.toContain('list-classification');
    expect(
      contractIssues(getRoute, {
        ...good,
        'x-gradix-response-kind': 'list',
        parameters: [],
      }),
    ).toContain('cursor-limit');
  });
  it('rejects dangling schema references', () => {
    const missingRef = {
      ...good,
      responses: {
        ...good.responses,
        '200': {
          description: 'ok',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Missing' },
            },
          },
        },
      },
    };
    expect(
      contractIssues(route, missingRef, { components: { schemas: {} } }),
    ).toContain('response-schema-200');
    expect(
      contractIssues(route, missingRef, {
        components: { schemas: { Missing: { type: 'object' } } },
      }),
    ).not.toContain('response-schema-200');
  });
  it('rejects undocumented new issues and exceptions without a reason', () => {
    expect(
      compareContractExceptions(
        [{ route: 'GET /api/items', issue: 'error-400' }],
        [],
      ),
    ).toHaveLength(1);
    expect(() =>
      compareContractExceptions(
        [],
        [{ route: 'GET /api/items', issue: 'error-400', reason: '' }],
      ),
    ).toThrow();
    expect(
      compareContractExceptions(
        [],
        [{ route: 'GET /api/items', issue: 'error-400', reason: 'reviewed' }],
      ),
    ).toEqual(['stale: GET /api/items|error-400']);
  });
});

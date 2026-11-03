import { HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';
import { AppExceptionFilter } from './app-exception.filter';

type MockResponse = { status: jest.Mock; json: jest.Mock };

function hostWith(response: MockResponse): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
}

function makeResponse(): MockResponse {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('AppExceptionFilter', () => {
  const filter = new AppExceptionFilter();
  let errorLog: jest.SpyInstance;
  let written: string[];

  beforeEach(() => {
    // INF-04: filter piše JSON red na stdout (kroz JsonLogger), ne `console.error`.
    written = [];
    errorLog = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown): boolean => {
        written.push(String(chunk));
        return true;
      });
  });
  afterEach(() => errorLog.mockRestore());

  it('prosljeđuje domenski AppError kakav jeste (kod, poruka, status, detalji)', () => {
    const response = makeResponse();
    filter.catch(
      new AppError(ERROR_CODES.PROJECT_ON_HOLD, 'Projekat je na čekanju', 409, {
        projectId: 'p1',
      }),
      hostWith(response),
    );
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'PROJECT_ON_HOLD',
        message: 'Projekat je na čekanju',
        details: { projectId: 'p1' },
      },
    });
  });

  it('mapira 429 na RATE_LIMITED (throttler)', () => {
    const response = makeResponse();
    filter.catch(
      new HttpException('Previše zahtjeva', HttpStatus.TOO_MANY_REQUESTS),
      hostWith(response),
    );
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: { code: ERROR_CODES.RATE_LIMITED, message: 'Previše zahtjeva' },
    });
  });

  it('spaja niz validacionih poruka u jednu', () => {
    const response = makeResponse();
    filter.catch(
      new HttpException(
        { message: ['email mora biti email', 'lozinka je prekratka'] },
        400,
      ),
      hostWith(response),
    );
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'email mora biti email; lozinka je prekratka',
      },
    });
  });

  it('neočekivanu grešku loguje, a klijentu ne odaje detalje', () => {
    const response = makeResponse();
    filter.catch(
      new Error('connection string leaked: postgres://u:p@db'),
      hostWith(response),
    );
    expect(errorLog).toHaveBeenCalled();
    const logged = JSON.parse(written.join(''));
    expect(logged.level).toBe('error');
    expect(logged.msg).toBe('Neočekivana greška');
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    const firstCall = response.json.mock.calls as unknown[][];
    const body = JSON.stringify(firstCall[0]?.[0]);
    expect(body).not.toContain('postgres://');
    expect(body).not.toContain('connection string');
  });
});

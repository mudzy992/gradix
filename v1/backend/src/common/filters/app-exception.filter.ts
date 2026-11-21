import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';
import { JsonLogger } from '../logging/json-logger';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new JsonLogger();

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof AppError) {
      response.status(exception.status).json({
        success: false,
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details ? { details: exception.details } : {}),
        },
      });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string' ? payload : this.readMessage(payload);
      response.status(status).json({
        success: false,
        error: { code: this.mapHttpCode(status), message },
      });
      return;
    }
    // BE-01 + INF-04: neočekivane greške idu kao JSON red (ime, poruka, stack) sa
    // korelacionim ID-om; klijent dobija generičku poruku — bez detalja implementacije.
    this.logger.write('error', 'Neočekivana greška', 'ExceptionFilter', {
      error: exception instanceof Error ? exception : String(exception),
    });
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }

  private readMessage(payload: unknown): string {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('message' in payload)
    ) {
      return 'Request failed';
    }
    const message = payload.message;
    if (Array.isArray(message)) {
      return message.join('; ');
    }
    return typeof message === 'string' ? message : 'Request failed';
  }

  private mapHttpCode(status: number): string {
    const byStatus: Record<number, string> = {
      [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
      [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
      [HttpStatus.UNAUTHORIZED]: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
      [HttpStatus.BAD_REQUEST]: ERROR_CODES.VALIDATION_FAILED,
      [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
      [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_CODES.SERVICE_UNAVAILABLE,
    };
    return byStatus[status] ?? 'HTTP_ERROR';
  }
}

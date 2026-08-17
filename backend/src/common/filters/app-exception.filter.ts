import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
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
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }

  private readMessage(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null || !('message' in payload)) {
      return 'Request failed';
    }
    const message = (payload as { message: unknown }).message;
    if (Array.isArray(message)) {
      return message.join('; ');
    }
    return typeof message === 'string' ? message : 'Request failed';
  }

  private mapHttpCode(status: number): string {
    if (status === HttpStatus.NOT_FOUND) {
      return ERROR_CODES.NOT_FOUND;
    }
    if (status === HttpStatus.FORBIDDEN) {
      return ERROR_CODES.FORBIDDEN;
    }
    if (status === HttpStatus.UNAUTHORIZED) {
      return ERROR_CODES.AUTH_INVALID_CREDENTIALS;
    }
    if (status === HttpStatus.CONFLICT) {
      return ERROR_CODES.CONFLICT;
    }
    if (status === HttpStatus.BAD_REQUEST) {
      return ERROR_CODES.VALIDATION_FAILED;
    }
    return 'HTTP_ERROR';
  }
}

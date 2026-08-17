import { ValidationError, ValidationPipe } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppError } from './common/errors/app-error';
import { ERROR_CODES } from './common/errors/error-codes';
import { AppExceptionFilter } from './common/filters/app-exception.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { Reflector } from '@nestjs/core';

function flattenErrors(errors: ValidationError[]): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    if (error.constraints) {
      messages.push(...Object.values(error.constraints));
    }
    if (error.children?.length) {
      messages.push(...flattenErrors(error.children));
    }
  }
  return messages;
}

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.use(helmet());
  const origins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          flattenErrors(errors).join('; ') || 'Validation failed',
          400,
        ),
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor(app.get(Reflector)));
  const swagger = new DocumentBuilder()
    .setTitle('Gradix API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger), {
    useGlobalPrefix: true,
  });
}

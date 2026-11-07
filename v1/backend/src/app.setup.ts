import { ValidationError, ValidationPipe } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import {
  isApiDocsEnabled,
  resolveCorsOrigin,
  resolveTrustProxy,
} from './config/env';
import { AppError } from './common/errors/app-error';
import { ERROR_CODES } from './common/errors/error-codes';
import { AppExceptionFilter } from './common/filters/app-exception.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { Reflector } from '@nestjs/core';
import { JsonLogger } from './common/logging/json-logger';
import { requestLogMiddleware } from './common/logging/request-log.middleware';

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
  // INF-04: svi Nest logovi idu kao JSON redovi (Coolify ih filtrira po `level`), a svaki
  // zahtjev dobija korelacioni ID koji se vraća u `x-request-id` i nosi kroz async lanac.
  app.useLogger(new JsonLogger());
  app.use(requestLogMiddleware());
  app.setGlobalPrefix('api');
  // D-042: iza Coolify proxy-ja bez ovoga `req.ip` je IP proxy-ja → jedan throttle bucket za sve.
  // Vjerujemo samo prvom hopu (kontejner nije direktno izložen; portovi su `expose`, ne `ports`).
  (app as NestExpressApplication).set(
    'trust proxy',
    resolveTrustProxy(process.env.TRUST_PROXY),
  );
  app.use(helmet());
  app.enableCors({
    origin: resolveCorsOrigin(process.env.NODE_ENV, process.env.CORS_ORIGIN),
    credentials: true,
  });
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
  // BE-01: u produkciji se API dokumentacija NE izlaže (osim uz ENABLE_API_DOCS=true) —
  // inače je cijela površina API-ja javno popisana.
  if (isApiDocsEnabled(process.env.NODE_ENV, process.env.ENABLE_API_DOCS)) {
    const swagger = new DocumentBuilder()
      .setTitle('Gradix API')
      .setDescription(
        'Decimal inputs are strings. Scale 3: trip quantity/weighQty, fuel liters, stock qty and project quantities; scale 2: monetary values, user hourlyRate and location accuracyM; scale 1: diary temperatures; scale 7: coordinates including geofence queries. Excess significant fractional digits are rejected with VALIDATION_FAILED (HTTP 400); trailing zeros are allowed. Excess scale is checked before processing any sync batch items. Other sync errors remain per-item in the HTTP 200 batch result. Existing data and computed amounts are not rewritten.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, swagger),
      {
        useGlobalPrefix: true,
      },
    );
  }
}

import {
  BadRequestException,
  type INestApplication,
  type ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import helmet from 'helmet';
import type { ApiFieldError } from '../libs/dto/common/api-error.response';
import { HttpExceptionFilter } from '../libs/filters/http-exception.filter';
import type { RuntimeEnvironment } from './environment';

function fieldErrors(errors: ValidationError[], parent = ''): ApiFieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? parent + '.' + error.property : error.property;
    const current = error.constraints
      ? [{ field, messages: Object.values(error.constraints) }]
      : [];

    return [...current, ...fieldErrors(error.children ?? [], field)];
  });
}

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<RuntimeEnvironment, true>);

  // Only the private production gateway may supply forwarded client addresses.
  // It preserves CloudFront's X-Forwarded-For; trust only its rightmost address.
  const server = app.getHttpAdapter().getInstance() as Express;
  server.set(
    'trust proxy',
    config.get('TRUST_PROXY', { infer: true }) ? 1 : false,
  );

  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: '입력값을 확인해 주세요.',
          errors: fieldErrors(errors),
        }),
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
}

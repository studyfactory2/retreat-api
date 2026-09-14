import {
  BadRequestException,
  type INestApplication,
  type ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

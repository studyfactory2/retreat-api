import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  ApiErrorResponse,
  ApiFieldError,
} from '../dto/common/api-error.response';

const DEFAULT_MESSAGES: Partial<Record<number, string>> = {
  400: '잘못된 요청입니다.',
  401: '로그인이 필요합니다.',
  403: '접근 권한이 없습니다.',
  404: '요청한 내용을 찾을 수 없습니다.',
  405: '허용되지 않은 요청 방식입니다.',
  413: '요청 크기가 너무 큽니다.',
  429: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
};

function isFieldError(value: unknown): value is ApiFieldError {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'field' in value &&
    typeof value.field === 'string' &&
    'messages' in value &&
    Array.isArray(value.messages) &&
    value.messages.every((message: unknown) => typeof message === 'string')
  );
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const path = request.originalUrl.split('?')[0];
    const body: ApiErrorResponse = {
      statusCode,
      code: HttpStatus[statusCode] ?? 'HTTP_ERROR',
      message:
        DEFAULT_MESSAGES[statusCode] ??
        '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      path,
      timestamp: new Date().toISOString(),
    };

    if (statusCode >= 500) {
      this.logger.error(
        request.method + ' ' + path,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      // Only explicitly declared public errors may expose custom messages.
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'code' in payload &&
        typeof payload.code === 'string' &&
        'message' in payload &&
        typeof payload.message === 'string'
      ) {
        body.code = payload.code;
        body.message = payload.message;
        if (
          'errors' in payload &&
          Array.isArray(payload.errors) &&
          payload.errors.every(isFieldError)
        ) {
          body.errors = payload.errors.map(({ field, messages }) => ({
            field,
            messages,
          }));
        }
      }
    }

    response.status(statusCode).json(body);
  }
}

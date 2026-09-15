import {
  BadRequestException,
  Body,
  Controller,
  Get,
  type INestApplication,
  Logger,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/config/configure-app';
import { validateEnvironment } from '../src/config/environment';
import { PrismaService } from '../src/database/prisma.service';
import type { ApiErrorResponse } from '../src/libs/dto/common/api-error.response';

class ProbeInput {
  @IsString({ message: '이름은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '이름을 입력해 주세요.' })
  name: string;

  @IsInt({ message: '수량은 정수여야 합니다.' })
  @Min(1, { message: '수량은 1 이상이어야 합니다.' })
  count: number;

  @IsBoolean({ message: '활성 상태를 확인해 주세요.' })
  enabled: boolean;
}

// These routes exist only inside this test module.
@Controller('__test')
class ProbeController {
  @Post('input')
  input(@Body() body: ProbeInput): ProbeInput {
    return body;
  }

  @Get('failure')
  failure(): never {
    throw new Error('sensitive-internal-detail');
  }

  @Get('unavailable')
  unavailable(): never {
    throw new ServiceUnavailableException('sensitive-upstream-detail');
  }

  @Get('business-error')
  businessError(): never {
    throw new BadRequestException({
      code: 'EXAMPLE_RULE',
      message: '요청 내용을 다시 확인해 주세요.',
    });
  }
}

describe('API foundation (e2e)', () => {
  let app: INestApplication<App>;
  let errorLog: jest.SpyInstance;

  beforeAll(async () => {
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService(
          validateEnvironment({
            NODE_ENV: 'test',
            CORS_ORIGINS: 'http://localhost:5173',
            DATABASE_URL: 'postgresql://retreat@127.0.0.1:1/retreat_test',
            JWT_SECRET: 'retreat-http-test-only-secret-not-for-runtime',
          }),
        ),
      )
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
    errorLog?.mockRestore();
  });

  it('serves liveness at /health with security and no-cache headers', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect('X-Content-Type-Options', 'nosniff')
      .expect('Cache-Control', 'no-store')
      .expect({ status: 'ok', service: 'retreat-api' });
  });

  it.each(['/', '/api/health'])(
    'does not expose the old route %s',
    async (path) => {
      await request(app.getHttpServer())
        .get(path)
        .expect(404)
        .expect(({ body }: { body: ApiErrorResponse }) => {
          expect(body).toMatchObject({
            statusCode: 404,
            code: 'NOT_FOUND',
            path,
          });
        });
    },
  );

  it('allows the configured frontend origin', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:5173')
      .expect('Access-Control-Allow-Origin', 'http://localhost:5173')
      .expect(200);
  });

  it('handles an allowed preflight', async () => {
    await request(app.getHttpServer())
      .options('/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .expect('Access-Control-Allow-Origin', 'http://localhost:5173')
      .expect(204);
  });

  it.each(['GET', 'OPTIONS'])(
    'does not grant CORS access to an unlisted origin (%s)',
    async (method) => {
      const client = request(app.getHttpServer());
      const call =
        method === 'GET' ? client.get('/health') : client.options('/health');
      const response = await call
        .set('Origin', 'https://unlisted.example')
        .set('Access-Control-Request-Method', 'GET');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(
        response.headers['access-control-allow-credentials'],
      ).toBeUndefined();
    },
  );

  it('accepts a valid DTO', async () => {
    const body = { name: '담당자 A', count: 2, enabled: false };
    await request(app.getHttpServer())
      .post('/__test/input')
      .send(body)
      .expect(201)
      .expect(body);
  });

  it('rejects invalid types without silently converting booleans', async () => {
    await request(app.getHttpServer())
      .post('/__test/input')
      .send({ name: 123, count: '2', enabled: 'false' })
      .expect(400)
      .expect(({ body }: { body: ApiErrorResponse }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
        expect(body.errors?.map((error) => error.field)).toEqual(
          expect.arrayContaining(['name', 'count', 'enabled']),
        );
        expect(body.errors?.length).toBe(3);
      });
  });

  it('rejects unexpected fields and omits query secrets from error paths', async () => {
    await request(app.getHttpServer())
      .post('/__test/input?token=private-link-secret')
      .send({ name: '담당자 A', count: 2, enabled: false, role: 'ADMIN' })
      .expect(400)
      .expect(({ body, text }: { body: ApiErrorResponse; text: string }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
        expect(body.path).toBe('/__test/input');
        expect(body.errors?.[0].field).toBe('role');
        expect(text).not.toContain('private-link-secret');
      });
  });

  it('normalizes malformed JSON without echoing its content', async () => {
    const response = await request(app.getHttpServer())
      .post('/__test/input')
      .set('Content-Type', 'application/json')
      .send('{"secret":"do-not-echo",')
      .expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: '잘못된 요청입니다.',
    });
    expect(response.text).not.toContain('do-not-echo');
  });

  it.each([
    ['/__test/failure', 500],
    ['/__test/unavailable', 503],
  ])('hides internal details from %s', async (path, statusCode) => {
    const response = await request(app.getHttpServer())
      .get(path)
      .expect(statusCode);
    expect(response.text).not.toContain('sensitive-');
    expect(response.body).toMatchObject({
      statusCode,
      message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  });

  it('preserves explicitly declared public business errors', async () => {
    const response = await request(app.getHttpServer())
      .get('/__test/business-error')
      .expect(400);
    expect(response.body).toMatchObject({
      code: 'EXAMPLE_RULE',
      message: '요청 내용을 다시 확인해 주세요.',
    });
  });
});

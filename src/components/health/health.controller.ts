import { Controller, Get, Header } from '@nestjs/common';
import type { HealthResponse } from '../../libs/dto/health/health.response';

@Controller('health')
export class HealthController {
  @Get()
  @Header('Cache-Control', 'no-store')
  getHealth(): HealthResponse {
    return { status: 'ok', service: 'retreat-api' };
  }
}

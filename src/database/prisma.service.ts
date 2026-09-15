import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { RuntimeEnvironment } from '../config/environment';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<RuntimeEnvironment, true>) {
    super({
      datasources: { db: { url: config.get('DATABASE_URL', { infer: true }) } },
      errorFormat: 'minimal',
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch {
      await this.$disconnect();
      throw new Error(
        'PostgreSQL connection failed. Check DATABASE_URL and database availability.',
      );
    }

    this.logger.log('PostgreSQL connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

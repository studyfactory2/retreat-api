import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './config/configure-app';
import type { RuntimeEnvironment } from './config/environment';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  try {
    configureApp(app);
    app.enableShutdownHooks();

    const config = app.get(ConfigService<RuntimeEnvironment, true>);
    const port = config.get('PORT', { infer: true });
    await app.listen(port);
    Logger.log('Retreat API listening on port ' + port, 'Bootstrap');
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : 'Application startup failed',
    undefined,
    'Bootstrap',
  );
  process.exitCode = 1;
});

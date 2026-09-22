import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from '../../config/environment';
import { DatabaseModule } from '../../database/database.module';
import { UploadCleanupModule } from './upload-cleanup.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    DatabaseModule,
    UploadCleanupModule,
  ],
})
export class UploadCleanupCommandModule {}

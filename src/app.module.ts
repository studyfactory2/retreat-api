import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ComponentsModule } from './components/components.module';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    DatabaseModule,
    ComponentsModule,
  ],
})
export class AppModule {}

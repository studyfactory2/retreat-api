import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ComponentsModule } from './components/components.module';
import { validateEnvironment } from './config/environment';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    ComponentsModule,
  ],
})
export class AppModule {}

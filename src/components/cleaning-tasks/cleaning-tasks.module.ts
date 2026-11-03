import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { CleaningTasksController } from './cleaning-tasks.controller';
import { CleaningTasksService } from './cleaning-tasks.service';

@Module({
  imports: [AuthModule],
  controllers: [CleaningTasksController],
  providers: [CleaningTasksService, QrNoStoreMiddleware],
})
export class CleaningTasksModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(CleaningTasksController);
  }
}

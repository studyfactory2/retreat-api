import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminSubmissionsController } from './admin-submissions.controller';
import { AdminSubmissionsService } from './admin-submissions.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [AdminSubmissionsController],
  providers: [AdminSubmissionsService, QrNoStoreMiddleware],
})
export class AdminSubmissionsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AdminSubmissionsController);
  }
}

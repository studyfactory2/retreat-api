import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminSubmissionStaysController } from './admin-submission-stays.controller';
import { AdminSubmissionStaysService } from './admin-submission-stays.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminSubmissionStaysController],
  providers: [AdminSubmissionStaysService, QrNoStoreMiddleware],
})
export class AdminSubmissionStaysModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(QrNoStoreMiddleware)
      .forRoutes(AdminSubmissionStaysController);
  }
}

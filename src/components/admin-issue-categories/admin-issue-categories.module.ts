import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminIssueCategoriesController } from './admin-issue-categories.controller';
import { AdminIssueCategoriesService } from './admin-issue-categories.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminIssueCategoriesController],
  providers: [AdminIssueCategoriesService, QrNoStoreMiddleware],
})
export class AdminIssueCategoriesModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(QrNoStoreMiddleware)
      .forRoutes(AdminIssueCategoriesController);
  }
}

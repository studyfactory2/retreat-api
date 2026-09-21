import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService, QrNoStoreMiddleware],
})
export class AdminDashboardModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AdminDashboardController);
  }
}

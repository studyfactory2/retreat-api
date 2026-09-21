import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminMaintenanceController } from './admin-maintenance.controller';
import { AdminMaintenanceService } from './admin-maintenance.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminMaintenanceController],
  providers: [AdminMaintenanceService, QrNoStoreMiddleware],
})
export class AdminMaintenanceModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AdminMaintenanceController);
  }
}

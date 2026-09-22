import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminStayVehiclesController } from './admin-stay-vehicles.controller';
import { AdminStayVehiclesService } from './admin-stay-vehicles.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminStayVehiclesController],
  providers: [AdminStayVehiclesService, QrNoStoreMiddleware],
})
export class AdminStayVehiclesModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AdminStayVehiclesController);
  }
}

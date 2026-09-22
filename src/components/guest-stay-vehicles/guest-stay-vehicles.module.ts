import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { GuestStayAccessGuard } from '../auth/guards/guest-stay-access.guard';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { StayAccessModule } from '../stay-access/stay-access.module';
import { GuestStayVehiclesController } from './guest-stay-vehicles.controller';
import { GuestStayVehiclesService } from './guest-stay-vehicles.service';

@Module({
  imports: [StayAccessModule],
  controllers: [GuestStayVehiclesController],
  providers: [
    GuestStayVehiclesService,
    GuestStayAccessGuard,
    QrNoStoreMiddleware,
  ],
})
export class GuestStayVehiclesModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(GuestStayVehiclesController);
  }
}

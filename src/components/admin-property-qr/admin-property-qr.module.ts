import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminPropertyQrController } from './admin-property-qr.controller';
import { AdminPropertyQrService } from './admin-property-qr.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminPropertyQrController],
  providers: [AdminPropertyQrService, QrNoStoreMiddleware],
})
export class AdminPropertyQrModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AdminPropertyQrController);
  }
}

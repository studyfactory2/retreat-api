import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPropertyQrController } from './admin-property-qr.controller';
import { QrController } from './qr.controller';
import { QrNoStoreMiddleware } from './qr-no-store.middleware';
import { QrService } from './qr.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminPropertyQrController, QrController],
  providers: [QrService, QrNoStoreMiddleware],
})
export class QrModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(QrNoStoreMiddleware)
      .forRoutes(AdminPropertyQrController, QrController);
  }
}

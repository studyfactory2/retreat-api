import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { QrController } from './qr.controller';
import { QrNoStoreMiddleware } from './qr-no-store.middleware';
import { QrService } from './qr.service';

@Module({
  controllers: [QrController],
  providers: [QrService, QrNoStoreMiddleware],
  exports: [QrService],
})
export class QrModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(QrController);
  }
}

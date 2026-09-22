import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { QrModule } from '../qr/qr.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { StayAccessModule } from '../stay-access/stay-access.module';
import { GuestPropertyGuidesController } from './guest-property-guides.controller';
import { GuestPropertyGuidesService } from './guest-property-guides.service';

@Module({
  imports: [QrModule, StayAccessModule],
  controllers: [GuestPropertyGuidesController],
  providers: [GuestPropertyGuidesService, QrNoStoreMiddleware],
})
export class GuestPropertyGuidesModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(QrNoStoreMiddleware)
      .forRoutes(GuestPropertyGuidesController);
  }
}

import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminPropertyGuidesController } from './admin-property-guides.controller';
import { AdminPropertyGuidesService } from './admin-property-guides.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminPropertyGuidesController],
  providers: [AdminPropertyGuidesService, QrNoStoreMiddleware],
})
export class AdminPropertyGuidesModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(QrNoStoreMiddleware)
      .forRoutes(AdminPropertyGuidesController);
  }
}

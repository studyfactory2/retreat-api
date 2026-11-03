import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminPropertyAccessController } from './admin-property-access.controller';
import { AdminPropertyAccessService } from './admin-property-access.service';
import { PropertyAccessCodeVault } from './property-access-code-vault';

@Module({
  imports: [AuthModule],
  exports: [PropertyAccessCodeVault],
  controllers: [AdminPropertyAccessController],
  providers: [
    AdminPropertyAccessService,
    PropertyAccessCodeVault,
    QrNoStoreMiddleware,
  ],
})
export class AdminPropertyAccessModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(QrNoStoreMiddleware)
      .forRoutes(AdminPropertyAccessController);
  }
}

import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPropertyAccessModule } from '../admin-property-access/admin-property-access.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminStayAccessController } from './admin-stay-access.controller';
import { AdminStayAccessService } from './admin-stay-access.service';
import { StayAccessCodeVault } from './stay-access-code-vault';

@Module({
  imports: [AuthModule, AdminPropertyAccessModule],
  controllers: [AdminStayAccessController],
  providers: [AdminStayAccessService, StayAccessCodeVault, QrNoStoreMiddleware],
  exports: [AdminStayAccessService],
})
export class AdminStayAccessModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AdminStayAccessController);
  }
}

import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AccessLinkVaultModule } from '../access-link-vault/access-link-vault.module';
import { AdminStayAccessModule } from '../admin-stay-access/admin-stay-access.module';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { MessageContextService } from './message-context.service';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { SolapiProvider } from './solapi.provider';

@Module({
  imports: [AuthModule, AccessLinkVaultModule, AdminStayAccessModule],
  controllers: [MessagingController],
  providers: [
    MessagingService,
    MessageContextService,
    SolapiProvider,
    QrNoStoreMiddleware,
  ],
  exports: [MessagingService],
})
export class MessagingModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(MessagingController);
  }
}

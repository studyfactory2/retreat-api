import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { MessageAutomationController } from './message-automation.controller';
import { MessageAutomationService } from './message-automation.service';
import { MessageAutomationRunner } from './message-automation.runner';

@Module({
  imports: [AuthModule, MessagingModule],
  controllers: [MessageAutomationController],
  providers: [
    MessageAutomationService,
    MessageAutomationRunner,
    QrNoStoreMiddleware,
  ],
})
export class MessageAutomationModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(MessageAutomationController);
  }
}

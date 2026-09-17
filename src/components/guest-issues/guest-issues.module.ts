import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { QrModule } from '../qr/qr.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { GuestIssuesController } from './guest-issues.controller';
import { GuestIssuesService } from './guest-issues.service';

@Module({
  imports: [QrModule],
  controllers: [GuestIssuesController],
  providers: [GuestIssuesService, QrNoStoreMiddleware],
})
export class GuestIssuesModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(GuestIssuesController);
  }
}

import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminCalendarController } from './admin-calendar.controller';
import { AdminCalendarService } from './admin-calendar.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminCalendarController],
  providers: [AdminCalendarService, QrNoStoreMiddleware],
})
export class AdminCalendarModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AdminCalendarController);
  }
}

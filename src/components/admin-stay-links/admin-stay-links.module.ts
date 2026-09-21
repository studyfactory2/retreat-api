import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminStayLinksController } from './admin-stay-links.controller';
import { AdminStayLinksService } from './admin-stay-links.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminStayLinksController],
  providers: [AdminStayLinksService, QrNoStoreMiddleware],
})
export class AdminStayLinksModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AdminStayLinksController);
  }
}

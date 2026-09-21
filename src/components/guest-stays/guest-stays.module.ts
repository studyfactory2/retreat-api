import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { GuestStayAccessGuard } from '../auth/guards/guest-stay-access.guard';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { StayAccessModule } from '../stay-access/stay-access.module';
import { SubmissionDraftsModule } from '../submission-drafts/submission-drafts.module';
import { GuestStaysController } from './guest-stays.controller';
import { GuestStaysService } from './guest-stays.service';

@Module({
  imports: [StayAccessModule, SubmissionDraftsModule],
  controllers: [GuestStaysController],
  providers: [GuestStaysService, GuestStayAccessGuard, QrNoStoreMiddleware],
})
export class GuestStaysModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(GuestStaysController);
  }
}

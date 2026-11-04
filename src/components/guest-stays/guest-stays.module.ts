import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { GuestStayAccessGuard } from '../auth/guards/guest-stay-access.guard';
import { AdminPropertyAccessModule } from '../admin-property-access/admin-property-access.module';
import { AdminStayAccessModule } from '../admin-stay-access/admin-stay-access.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { StayAccessModule } from '../stay-access/stay-access.module';
import { SubmissionDraftsModule } from '../submission-drafts/submission-drafts.module';
import { GuestStaysController } from './guest-stays.controller';
import { GuestStaysService } from './guest-stays.service';
import { GuestStayCodesController } from './guest-stay-codes.controller';
import { GuestStayCodesService } from './guest-stay-codes.service';

@Module({
  imports: [
    StayAccessModule,
    SubmissionDraftsModule,
    AdminStayAccessModule,
    AdminPropertyAccessModule,
  ],
  controllers: [GuestStaysController, GuestStayCodesController],
  providers: [
    GuestStaysService,
    GuestStayCodesService,
    GuestStayAccessGuard,
    QrNoStoreMiddleware,
  ],
})
export class GuestStaysModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(QrNoStoreMiddleware)
      .forRoutes(GuestStaysController, GuestStayCodesController);
  }
}

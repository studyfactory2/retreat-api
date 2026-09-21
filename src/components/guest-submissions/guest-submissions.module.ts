import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { GuestSubmissionAccessGuard } from '../auth/guards/guest-submission-access.guard';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { SubmissionDraftsModule } from '../submission-drafts/submission-drafts.module';
import { GuestSubmissionCorrectionsService } from './guest-submission-corrections.service';
import { GuestSubmissionsController } from './guest-submissions.controller';
import { GuestSubmissionsService } from './guest-submissions.service';

@Module({
  imports: [SubmissionDraftsModule, StorageModule],
  controllers: [GuestSubmissionsController],
  providers: [
    GuestSubmissionsService,
    GuestSubmissionCorrectionsService,
    GuestSubmissionAccessGuard,
    QrNoStoreMiddleware,
  ],
})
export class GuestSubmissionsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(GuestSubmissionsController);
  }
}

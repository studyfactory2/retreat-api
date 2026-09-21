import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { QrModule } from '../qr/qr.module';
import { StayAccessModule } from '../stay-access/stay-access.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { SubmissionDraftsController } from './submission-drafts.controller';
import { SubmissionDraftsService } from './submission-drafts.service';

@Module({
  imports: [QrModule, StayAccessModule],
  controllers: [SubmissionDraftsController],
  providers: [SubmissionDraftsService, QrNoStoreMiddleware],
  exports: [SubmissionDraftsService],
})
export class SubmissionDraftsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(SubmissionDraftsController);
  }
}

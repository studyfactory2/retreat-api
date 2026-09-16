import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { SubmissionDraftsModule } from '../submission-drafts/submission-drafts.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [SubmissionDraftsModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, QrNoStoreMiddleware],
})
export class SubmissionsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(SubmissionsController);
  }
}

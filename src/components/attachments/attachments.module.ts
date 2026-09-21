import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { SubmissionDraftsModule } from '../submission-drafts/submission-drafts.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { DraftPhotoAccessGuard } from '../auth/guards/draft-photo-access.guard';
import { PhotoProcessingModule } from '../photo-processing/photo-processing.module';

@Module({
  imports: [SubmissionDraftsModule, StorageModule, PhotoProcessingModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, DraftPhotoAccessGuard, QrNoStoreMiddleware],
})
export class AttachmentsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AttachmentsController);
  }
}

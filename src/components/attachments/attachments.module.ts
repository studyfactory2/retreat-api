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
import { DraftPhotoAccessGuard } from './draft-photo-access.guard';
import { PhotoImageService } from './photo-image.service';
import { PhotoUploadCapacityInterceptor } from './photo-upload-capacity.interceptor';

@Module({
  imports: [SubmissionDraftsModule, StorageModule],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    DraftPhotoAccessGuard,
    PhotoImageService,
    PhotoUploadCapacityInterceptor,
    QrNoStoreMiddleware,
  ],
})
export class AttachmentsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AttachmentsController);
  }
}

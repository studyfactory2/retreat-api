import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { PhotoProcessingModule } from '../photo-processing/photo-processing.module';
import { QrModule } from '../qr/qr.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { GuestIssuePhotoAccessGuard } from '../auth/guards/guest-issue-photo-access.guard';
import { GuestIssuePhotoClaimsService } from './guest-issue-photo-claims.service';
import { GuestIssuePhotosController } from './guest-issue-photos.controller';
import { GuestIssuePhotosService } from './guest-issue-photos.service';

@Module({
  imports: [QrModule, StorageModule, PhotoProcessingModule],
  controllers: [GuestIssuePhotosController],
  providers: [
    GuestIssuePhotosService,
    GuestIssuePhotoClaimsService,
    GuestIssuePhotoAccessGuard,
    QrNoStoreMiddleware,
  ],
  exports: [GuestIssuePhotoClaimsService],
})
export class GuestIssuePhotosModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(GuestIssuePhotosController);
  }
}

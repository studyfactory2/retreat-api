import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminIssueReader } from '../admin-issues/admin-issue-reader';
import { AdminSubmissionCorrectionsService } from './admin-submission-corrections.service';
import { AdminSubmissionStatusService } from './admin-submission-status.service';
import { AdminSubmissionsController } from './admin-submissions.controller';
import { AdminSubmissionsService } from './admin-submissions.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [AdminSubmissionsController],
  providers: [
    AdminSubmissionsService,
    AdminSubmissionCorrectionsService,
    AdminSubmissionStatusService,
    AdminIssueReader,
    QrNoStoreMiddleware,
  ],
})
export class AdminSubmissionsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AdminSubmissionsController);
  }
}

import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { PreservationZipService } from './preservation-zip.service';
import { AuthModule } from '../auth/auth.module';
import { AdminIssueReader } from '../admin-issues/admin-issue-reader';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminReportReaderService } from './admin-report-reader.service';
import { AdminReportWorkbookService } from './admin-report-workbook.service';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';
import { PreservationReportReaderService } from './preservation-report-reader.service';
import { PreservationReportWorkbookService } from './preservation-report-workbook.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [AdminReportsController],
  providers: [
    AdminReportsService,
    AdminReportReaderService,
    AdminReportWorkbookService,
    PreservationReportReaderService,
    PreservationReportWorkbookService,
    PreservationZipService,
    AdminIssueReader,
    QrNoStoreMiddleware,
  ],
})
export class AdminReportsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AdminReportsController);
  }
}

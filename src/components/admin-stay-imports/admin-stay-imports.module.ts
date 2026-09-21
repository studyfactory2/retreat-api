import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminImportUploadCapacityInterceptor } from './admin-import-upload-capacity.interceptor';
import { AdminStayImportsController } from './admin-stay-imports.controller';
import { AdminStayImportsService } from './admin-stay-imports.service';
import { RosterWorkbookReaderService } from './roster-workbook-reader.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [AdminStayImportsController],
  providers: [
    AdminStayImportsService,
    RosterWorkbookReaderService,
    AdminImportUploadCapacityInterceptor,
    QrNoStoreMiddleware,
  ],
})
export class AdminStayImportsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AdminStayImportsController);
  }
}

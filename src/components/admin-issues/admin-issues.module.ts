import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminIssuePhotosService } from './admin-issue-photos.service';
import { AdminIssueReader } from './admin-issue-reader';
import { AdminIssuesController } from './admin-issues.controller';
import { AdminIssuesService } from './admin-issues.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [AdminIssuesController],
  providers: [
    AdminIssuesService,
    AdminIssueReader,
    AdminIssuePhotosService,
    QrNoStoreMiddleware,
  ],
})
export class AdminIssuesModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QrNoStoreMiddleware).forRoutes(AdminIssuesController);
  }
}

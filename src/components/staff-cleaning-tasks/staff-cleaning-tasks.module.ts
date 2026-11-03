import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { QrModule } from '../qr/qr.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { SubmissionDraftsModule } from '../submission-drafts/submission-drafts.module';
import { CleaningTaskAccessModule } from '../cleaning-task-access/cleaning-task-access.module';
import { StaffCleaningTasksService } from './staff-cleaning-tasks.service';
import { StaffCleaningTasksController } from './staff-cleaning-tasks.controller';
import { TaskPasswordController } from './task-password.controller';

@Module({
  imports: [QrModule, SubmissionDraftsModule, CleaningTaskAccessModule],
  controllers: [StaffCleaningTasksController, TaskPasswordController],
  providers: [StaffCleaningTasksService, QrNoStoreMiddleware],
})
export class StaffCleaningTasksModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(QrNoStoreMiddleware)
      .forRoutes(StaffCleaningTasksController, TaskPasswordController);
  }
}

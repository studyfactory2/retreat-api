import { Module } from '@nestjs/common';
import { AdminStayAccessModule } from '../admin-stay-access/admin-stay-access.module';
import { AdminPropertyAccessModule } from '../admin-property-access/admin-property-access.module';
import { CleaningTaskAccessService } from './cleaning-task-access.service';

@Module({
  imports: [AdminStayAccessModule, AdminPropertyAccessModule],
  providers: [CleaningTaskAccessService],
  exports: [CleaningTaskAccessService],
})
export class CleaningTaskAccessModule {}
